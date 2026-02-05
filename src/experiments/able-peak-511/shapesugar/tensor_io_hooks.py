import torch
import torch.nn as nn
    
def shape_hook(name):
    def hook(module, inp, out):
        # inp is a tuple
        in_shape = tuple(inp[0].shape) if inp else None

        # out can be Tensor or tuple/list of Tensors
        if isinstance(out, torch.Tensor):
            out_shape = tuple(out.shape)
        elif isinstance(out, (tuple, list)) and out and isinstance(out[0], torch.Tensor):
            out_shape = [tuple(o.shape) for o in out]
        else:
            out_shape = type(out)

        print(f"{name:10s} | {module.__class__.__name__:10s} | {in_shape} -> {out_shape}")
    return hook

def add_hooks(model):
    hooks = []
    for name, m in model.named_modules():
        # skip the top-level container to reduce noise
        if name == "":
            continue
        # focus on "leaf" modules (no children) for cleaner output
        if len(list(m.children())) == 0:
            hooks.append(m.register_forward_hook(shape_hook(name)))
    return hooks

if __name__ == "__main__":
    class TinyCNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.stem = nn.Sequential(
                nn.Conv2d(3, 16, 3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
            )
            self.block = nn.Sequential(
                nn.Conv2d(16, 32, 3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
            )
            self.head = nn.Sequential(
                nn.Flatten(),
                nn.Linear(32 * 56 * 56, 10),
            )

        def forward(self, x):
            x = self.stem(x)
            x = self.block(x)
            x = self.head(x)
            return x
        
    # ---- example use ----
    model = TinyCNN()  # your conv net
    hooks = add_hooks(model)

    x = torch.randn(1, 3, 224, 224)
    with torch.no_grad():
        _ = model(x)

    for h in hooks:
        h.remove()