"""GazeNet — lightweight CNN for gaze prediction, trained on calibration eye crops.

Uses tinygrad for fast inference. ~35K parameters.
Input: two 32x32 grayscale eye crops (left, right) stacked as 2-channel tensor.
Output: (x, y) normalized screen coordinates in [0, 1].
"""
import json
import os
import time
import numpy as np

try:
    from tinygrad import Tensor, dtypes
    from tinygrad.nn import Conv2d, Linear
    from tinygrad.nn.optim import Adam
    from tinygrad.nn.state import safe_save, safe_load, get_state_dict, load_state_dict
    HAS_TINYGRAD = True
except ImportError:
    HAS_TINYGRAD = False

WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), "neuralook_weights.safetensors")


class GazeNet:
    """Small CNN: 2-ch 32x32 -> conv layers -> MLP -> (x, y)."""

    def __init__(self):
        # Shared conv layers
        self.conv1 = Conv2d(2, 16, 3, padding=1)   # -> 16x32x32
        self.conv2 = Conv2d(16, 32, 3, padding=1)   # -> 32x16x16 after pool -> 32x8x8 after pool
        # MLP head  (32 * 8 * 8 = 2048)
        self.fc1 = Linear(2048, 128)
        self.fc2 = Linear(128, 2)

    def forward(self, x):
        """x: (B, 2, 32, 32) float tensor in [0, 1]."""
        x = self.conv1(x).relu().max_pool2d(kernel_size=(2, 2))   # -> (B, 16, 16, 16)
        x = self.conv2(x).relu().max_pool2d(kernel_size=(2, 2))   # -> (B, 32, 8, 8)
        x = x.reshape(x.shape[0], -1)                              # -> (B, 2048)
        x = self.fc1(x).relu()                                     # -> (B, 128)
        x = self.fc2(x).sigmoid()                                  # -> (B, 2) in [0, 1]
        return x


def _augment(lefts, rights, xs, ys):
    """Data augmentation: horizontal flip (swap eyes + mirror x), brightness/noise."""
    n = len(xs)
    aug_l, aug_r, aug_x, aug_y = list(lefts), list(rights), list(xs), list(ys)

    for i in range(n):
        # Horizontal flip: swap left/right eyes and flip each horizontally, mirror x
        fl = np.flip(rights[i].reshape(32, 32), axis=1).flatten()
        fr = np.flip(lefts[i].reshape(32, 32), axis=1).flatten()
        aug_l.append(fl.copy())
        aug_r.append(fr.copy())
        aug_x.append(1.0 - xs[i])
        aug_y.append(ys[i])

        # Small brightness jitter
        jitter = np.random.uniform(0.85, 1.15)
        jl = np.clip(lefts[i] * jitter, 0, 1)
        jr = np.clip(rights[i] * jitter, 0, 1)
        aug_l.append(jl)
        aug_r.append(jr)
        aug_x.append(xs[i])
        aug_y.append(ys[i])

        # Small gaussian noise
        noise_l = np.clip(lefts[i] + np.random.normal(0, 0.03, 1024), 0, 1)
        noise_r = np.clip(rights[i] + np.random.normal(0, 0.03, 1024), 0, 1)
        aug_l.append(noise_l)
        aug_r.append(noise_r)
        aug_x.append(xs[i])
        aug_y.append(ys[i])

    return (np.array(aug_l, dtype=np.float32),
            np.array(aug_r, dtype=np.float32),
            np.array(aug_x, dtype=np.float32),
            np.array(aug_y, dtype=np.float32))


def train(samples, epochs=200, lr=0.001):
    """Train GazeNet on calibration samples.

    samples: list of {left: [1024 floats], right: [1024 floats], x: float, y: float}
    Returns (model, accuracy_info).
    """
    if not HAS_TINYGRAD:
        raise RuntimeError("tinygrad not installed — pip3 install tinygrad")

    n = len(samples)
    if n < 4:
        raise ValueError(f"Need at least 4 samples, got {n}")

    # Extract arrays
    lefts = np.array([s["left"] for s in samples], dtype=np.float32) / 255.0
    rights = np.array([s["right"] for s in samples], dtype=np.float32) / 255.0
    xs = np.array([s["x"] for s in samples], dtype=np.float32)
    ys = np.array([s["y"] for s in samples], dtype=np.float32)

    # Augment
    lefts, rights, xs, ys = _augment(lefts, rights, xs, ys)
    total = len(xs)

    # Stack as 2-channel input: (N, 2, 32, 32)
    left_imgs = lefts.reshape(total, 1, 32, 32)
    right_imgs = rights.reshape(total, 1, 32, 32)
    input_np = np.concatenate([left_imgs, right_imgs], axis=1)
    target_np = np.stack([xs, ys], axis=1)  # (N, 2)

    model = GazeNet()
    opt = Adam(get_state_dict(model).values(), lr=lr)

    X = Tensor(input_np)
    Y = Tensor(target_np)

    t0 = time.time()
    final_loss = 0.0

    with Tensor.train():
        for epoch in range(epochs):
            pred = model.forward(X)
            loss = ((pred - Y) ** 2).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
            final_loss = loss.numpy().item()

    train_time = time.time() - t0

    # Save weights
    safe_save(get_state_dict(model), WEIGHTS_PATH)

    # Compute per-sample error on original (non-augmented) data
    orig_n = n
    orig_input = Tensor(input_np[:orig_n])
    orig_target = target_np[:orig_n]
    orig_pred = model.forward(orig_input).numpy()
    errors = np.sqrt(np.sum((orig_pred - orig_target) ** 2, axis=1))
    avg_error = float(np.mean(errors))

    info = {
        "samples": n,
        "augmented": total,
        "epochs": epochs,
        "final_loss": round(final_loss, 6),
        "avg_error_norm": round(avg_error, 4),
        "train_time_s": round(train_time, 2),
        "params": _count_params(model),
    }
    return model, info


def load_model():
    """Load a trained GazeNet from saved weights. Returns model or None."""
    if not HAS_TINYGRAD:
        return None
    if not os.path.exists(WEIGHTS_PATH):
        return None
    model = GazeNet()
    state = safe_load(WEIGHTS_PATH)
    load_state_dict(model, state)
    return model


def predict(model, left_patch, right_patch):
    """Run inference. left/right: bytes or list of 1024 uint8 values.
    Returns (x, y) as floats in [0, 1].
    """
    left = np.frombuffer(left_patch if isinstance(left_patch, bytes) else bytes(left_patch),
                         dtype=np.uint8).astype(np.float32) / 255.0
    right = np.frombuffer(right_patch if isinstance(right_patch, bytes) else bytes(right_patch),
                          dtype=np.uint8).astype(np.float32) / 255.0
    inp = np.zeros((1, 2, 32, 32), dtype=np.float32)
    inp[0, 0] = left.reshape(32, 32)
    inp[0, 1] = right.reshape(32, 32)

    out = model.forward(Tensor(inp)).numpy()[0]
    return float(out[0]), float(out[1])


def _count_params(model):
    total = 0
    for v in get_state_dict(model).values():
        total += int(np.prod(v.shape))
    return total
