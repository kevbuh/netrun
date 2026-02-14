#!/usr/bin/env python3
"""Neuralook service — standalone Python process for PyTorch gaze model operations.

Reads JSON-line commands from stdin, writes JSON-line responses to stdout.
Commands:
  {"cmd": "train", "id": "...", ...}       — train model (streams progress events)
  {"cmd": "predict", "id": "...", ...}     — predict gaze point
  {"cmd": "reset-hidden", "id": "...", "method": "cnn"}
  {"cmd": "auto-refine", "id": "...", ...} — auto-refine with implicit samples
  {"cmd": "shutdown"}
"""
import json
import sys
import os
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Reuse the existing neuralook route logic
# Import will be lazy for torch-dependent code
_DIR = os.environ.get('ARXIV_DATA_DIR', os.path.join(os.path.expanduser('~'), '.aether_data'))
os.makedirs(_DIR, exist_ok=True)

# Neuralook state (mirrors routes/neuralook.py)
_neuralook_models = {}
_neuralook_screen = None
_neuralook_hidden = {}
_output_lock = threading.Lock()


def _send(obj):
    """Write a JSON line to stdout (thread-safe)."""
    with _output_lock:
        sys.stdout.write(json.dumps(obj) + '\n')
        sys.stdout.flush()


def _handle_train(body, req_id):
    """Train the gaze model, streaming progress back."""
    try:
        import torch
        import torch.nn as nn
        import random

        global _neuralook_models, _neuralook_screen, _neuralook_hidden

        # Import model classes from neuralook route (reuse)
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'routes'))
        from neuralook import (
            _nl_get_model_class, _nl_save_model, _nl_load_model,
            _nl_build_temporal_sequences, _neuralook_models as _route_models
        )

        method = body.get('method', 'cnn')
        refine = body.get('refine', False)
        samples = body.get('samples', [])

        if not samples:
            calib_path = os.path.join(_DIR, 'neuralook_calibration.json')
            if os.path.exists(calib_path):
                with open(calib_path) as f:
                    calib = json.load(f)
                samples = calib.get('samples', [])
                body.setdefault('screenW', calib.get('screenW', 1920))
                body.setdefault('screenH', calib.get('screenH', 1080))
                body.setdefault('eyeW', calib.get('eyeW', 128))
                body.setdefault('eyeH', calib.get('eyeH', 64))

        # Load implicit samples for refine
        implicit_samples = []
        if refine:
            impl_path = os.path.join(_DIR, 'neuralook_implicit.json')
            if os.path.exists(impl_path):
                try:
                    with open(impl_path) as f:
                        implicit_samples = json.load(f)
                except Exception:
                    pass
            if not implicit_samples:
                _send({'id': req_id, 'event': 'error', 'error': 'No implicit samples available for refinement'})
                return
            samples = samples + implicit_samples

        screen_w = body.get('screenW', 1920)
        screen_h = body.get('screenH', 1080)
        eye_w = body.get('eyeW', 128)
        eye_h = body.get('eyeH', 64)

        if len(samples) < 10:
            _send({'id': req_id, 'event': 'error', 'error': f'Need at least 10 samples, got {len(samples)}'})
            return

        # Build tensors
        iris_default = [0.5, 0.5, 0.5, 0.5, 0.3, 0.3]
        eye_size = eye_w * eye_h
        X_list, AUX_list, Y_list = [], [], []
        for s in samples:
            raw = s['eyeData']
            if len(raw) != eye_size * 2:
                continue
            left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
            right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
            X_list.append(torch.cat([left, right], dim=0))
            hp = s.get('headPose', [0.0, 0.0, 0.0])[:3]
            hp = hp + [0.0] * (3 - len(hp))
            iris = s.get('irisFeatures', iris_default)[:6]
            iris = iris + [0.0] * (6 - len(iris))
            AUX_list.append(hp + iris)
            Y_list.append([s['screenX'] / screen_w, s['screenY'] / screen_h])

        if len(X_list) < 10:
            _send({'id': req_id, 'event': 'error', 'error': f'Only {len(X_list)} valid samples'})
            return

        X = torch.stack(X_list)
        AUX = torch.tensor(AUX_list, dtype=torch.float32)
        Y = torch.tensor(Y_list, dtype=torch.float32)

        # Train/val split
        targets_rounded = [(round(s['screenX']), round(s['screenY'])) for s in samples if len(s['eyeData']) == eye_size * 2]
        unique_targets = list(set(targets_rounded))
        n_val_points = max(2, len(unique_targets) // 4)
        random.shuffle(unique_targets)
        val_targets = set(unique_targets[:n_val_points])
        val_mask = torch.tensor([t in val_targets for t in targets_rounded])
        train_mask = ~val_mask

        X_train, AUX_train, Y_train = X[train_mask], AUX[train_mask], Y[train_mask]
        X_val, AUX_val, Y_val = X[val_mask], AUX[val_mask], Y[val_mask]

        ModelClass = _nl_get_model_class(method)
        model = ModelClass(aux_dim=9, temporal=False)  # Simplified: skip temporal for service
        optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
        max_epochs = 100
        patience = 30

        _send({'id': req_id, 'event': 'progress', 'data': {'epoch': 0, 'max_epochs': max_epochs, 'phase': 'training'}})

        n_train = X_train.shape[0]
        batch_size = min(64, n_train)
        best_val_loss = float('inf')
        best_state = None
        no_improve = 0

        for epoch in range(max_epochs):
            model.train()
            perm = torch.randperm(n_train)
            epoch_loss = 0.0
            n_batches = 0
            for start in range(0, n_train, batch_size):
                idx = perm[start:start + batch_size]
                pred, _ = model(X_train[idx], AUX_train[idx])
                loss = nn.functional.mse_loss(pred, Y_train[idx])
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                epoch_loss += loss.item()
                n_batches += 1

            if epoch % 10 == 0:
                model.eval()
                with torch.no_grad():
                    val_pred, _ = model(X_val, AUX_val)
                    val_loss = nn.functional.mse_loss(val_pred, Y_val).item()
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    best_state = {k: v.clone() for k, v in model.state_dict().items()}
                    no_improve = 0
                else:
                    no_improve += 10
                _send({'id': req_id, 'event': 'progress', 'data': {
                    'epoch': epoch, 'max_epochs': max_epochs,
                    'val_loss': round(val_loss, 6),
                    'train_loss': round(epoch_loss / max(n_batches, 1), 6),
                    'phase': 'training',
                }})
                if no_improve >= patience:
                    break

        if best_state:
            model.load_state_dict(best_state)
        model.eval()

        with torch.no_grad():
            train_pred, _ = model(X_train, AUX_train)
            tp = train_pred.clone(); tp[:, 0] *= screen_w; tp[:, 1] *= screen_h
            yt = Y_train.clone(); yt[:, 0] *= screen_w; yt[:, 1] *= screen_h
            train_err = torch.sqrt(((tp - yt) ** 2).sum(dim=1)).mean().item()
            vp, _ = model(X_val, AUX_val)
            vp2 = vp.clone(); vp2[:, 0] *= screen_w; vp2[:, 1] *= screen_h
            yv = Y_val.clone(); yv[:, 0] *= screen_w; yv[:, 1] *= screen_h
            val_err = torch.sqrt(((vp2 - yv) ** 2).sum(dim=1)).mean().item()

        _neuralook_models[method] = model
        _neuralook_screen = (screen_w, screen_h, eye_w, eye_h)
        _nl_save_model(model, screen_w, screen_h, eye_w, eye_h, method)

        if refine:
            impl_path = os.path.join(_DIR, 'neuralook_implicit.json')
            if os.path.exists(impl_path):
                os.remove(impl_path)

        _send({'id': req_id, 'event': 'done', 'data': {
            'method': method, 'train_error_px': round(train_err, 1),
            'val_error_px': round(val_err, 1), 'samples': len(X_list),
        }})
    except ImportError:
        _send({'id': req_id, 'event': 'error', 'error': 'PyTorch not installed'})
    except Exception as e:
        _send({'id': req_id, 'event': 'error', 'error': str(e)})


def _handle_predict(body, req_id):
    """Predict gaze point."""
    try:
        import torch
        global _neuralook_models, _neuralook_screen, _neuralook_hidden

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'routes'))
        from neuralook import _nl_load_model

        method = body.get('method', 'cnn')
        model = _neuralook_models.get(method)
        if model is None:
            model, screen_info = _nl_load_model(method)
            if model is None:
                _send({'id': req_id, 'event': 'error', 'error': f'Model not trained for method: {method}'})
                return
            _neuralook_models[method] = model
            _neuralook_screen = screen_info

        raw = body.get('eyeData', [])
        hp_raw = body.get('headPose', [0.0, 0.0, 0.0])
        iris_raw = body.get('irisFeatures', [0.5, 0.5, 0.5, 0.5, 0.3, 0.3])
        _tw, _th, eye_w, eye_h = _neuralook_screen
        screen_w = body.get('screenW', _tw)
        screen_h = body.get('screenH', _th)
        eye_size = eye_w * eye_h

        if len(raw) != eye_size * 2:
            _send({'id': req_id, 'event': 'error', 'error': f'Expected {eye_size * 2} values, got {len(raw)}'})
            return

        left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
        right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
        inp = torch.cat([left, right], dim=0).unsqueeze(0)
        hp = hp_raw[:3] + [0.0] * max(0, 3 - len(hp_raw))
        iris = iris_raw[:6] + [0.0] * max(0, 6 - len(iris_raw))
        aux = torch.tensor([hp + iris], dtype=torch.float32)

        model.eval()
        with torch.no_grad():
            hidden = _neuralook_hidden.get(method)
            pred, new_hidden = model(inp, aux, hidden)
            if new_hidden is not None:
                _neuralook_hidden[method] = tuple(h.detach() for h in new_hidden)
            pred = pred[0]

        _send({'id': req_id, 'event': 'done', 'data': {
            'x': round(pred[0].item() * screen_w, 1),
            'y': round(pred[1].item() * screen_h, 1),
        }})
    except Exception as e:
        _send({'id': req_id, 'event': 'error', 'error': str(e)})


def _handle_auto_refine(body, req_id):
    """Auto-refine with implicit samples (micro-training)."""
    try:
        import torch
        import torch.nn as nn
        import random
        global _neuralook_models, _neuralook_screen, _neuralook_hidden

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'routes'))
        from neuralook import _nl_load_model, _nl_save_model, _nl_get_model_class, _nl_append_refine_history

        screen_w = body.get('screenW', 1920)
        screen_h = body.get('screenH', 1080)
        eye_w = body.get('eyeW', 128)
        eye_h = body.get('eyeH', 64)
        baseline_val_error = body.get('baseline_val_error')

        calib_path = os.path.join(_DIR, 'neuralook_calibration.json')
        samples = []
        if os.path.exists(calib_path):
            with open(calib_path) as f:
                calib = json.load(f)
            samples = calib.get('samples', [])

        impl_path = os.path.join(_DIR, 'neuralook_implicit.json')
        implicit_samples = []
        if os.path.exists(impl_path):
            try:
                with open(impl_path) as f:
                    implicit_samples = json.load(f)
            except Exception:
                pass

        if not implicit_samples:
            _send({'id': req_id, 'event': 'done', 'data': {'rejected': True, 'reason': 'No implicit samples'}})
            return

        all_samples = samples + implicit_samples
        iris_default = [0.5, 0.5, 0.5, 0.5, 0.3, 0.3]
        eye_size = eye_w * eye_h
        X_list, AUX_list, Y_list = [], [], []
        for s in all_samples:
            raw = s['eyeData']
            if len(raw) != eye_size * 2:
                continue
            left = torch.tensor(raw[:eye_size], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
            right = torch.tensor(raw[eye_size:], dtype=torch.float32).view(1, eye_h, eye_w) / 255.0
            X_list.append(torch.cat([left, right], dim=0))
            hp = s.get('headPose', [0.0, 0.0, 0.0])[:3]
            hp = hp + [0.0] * (3 - len(hp))
            iris = s.get('irisFeatures', iris_default)[:6]
            iris = iris + [0.0] * (6 - len(iris))
            AUX_list.append(hp + iris)
            Y_list.append([s['screenX'] / screen_w, s['screenY'] / screen_h])

        if len(X_list) < 10:
            _send({'id': req_id, 'event': 'done', 'data': {'rejected': True, 'reason': f'Only {len(X_list)} valid samples'}})
            return

        X = torch.stack(X_list)
        AUX = torch.tensor(AUX_list, dtype=torch.float32)
        Y = torch.tensor(Y_list, dtype=torch.float32)

        targets_rounded = [(round(s['screenX']), round(s['screenY'])) for s in all_samples if len(s['eyeData']) == eye_size * 2]
        unique_targets = list(set(targets_rounded))
        n_val_points = max(2, len(unique_targets) // 4)
        random.shuffle(unique_targets)
        val_targets = set(unique_targets[:n_val_points])
        val_mask = torch.tensor([t in val_targets for t in targets_rounded])
        train_mask = ~val_mask
        X_train, AUX_train, Y_train = X[train_mask], AUX[train_mask], Y[train_mask]
        X_val, AUX_val, Y_val = X[val_mask], AUX[val_mask], Y[val_mask]

        method = body.get('method', 'cnn')
        model = _neuralook_models.get(method)
        if model is None:
            model, screen_info = _nl_load_model(method)
            if model is None:
                _send({'id': req_id, 'event': 'done', 'data': {'rejected': True, 'reason': 'No existing model'}})
                return
            _neuralook_models[method] = model
            _neuralook_screen = screen_info

        for param in model.features.parameters():
            param.requires_grad = False
        trainable_params = [p for p in model.parameters() if p.requires_grad]
        optimizer = torch.optim.Adam(trainable_params, lr=2e-5, weight_decay=1e-4)

        n_train = X_train.shape[0]
        batch_size = min(64, n_train)
        best_val_loss = float('inf')
        best_state = None
        no_improve = 0

        for epoch in range(30):
            model.train()
            perm = torch.randperm(n_train)
            for start in range(0, n_train, batch_size):
                idx = perm[start:start + batch_size]
                pred, _ = model(X_train[idx], AUX_train[idx])
                loss = nn.functional.mse_loss(pred, Y_train[idx])
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
            model.eval()
            with torch.no_grad():
                val_pred, _ = model(X_val, AUX_val)
                val_loss = nn.functional.mse_loss(val_pred, Y_val).item()
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_state = {k: v.clone() for k, v in model.state_dict().items()}
                no_improve = 0
            else:
                no_improve += 1
            if no_improve >= 10:
                break

        if best_state:
            model.load_state_dict(best_state)
        model.eval()

        with torch.no_grad():
            tp, _ = model(X_train, AUX_train)
            tp[:, 0] *= screen_w; tp[:, 1] *= screen_h
            yt = Y_train.clone(); yt[:, 0] *= screen_w; yt[:, 1] *= screen_h
            train_err = round(torch.sqrt(((tp - yt) ** 2).sum(dim=1)).mean().item(), 1)
            vp, _ = model(X_val, AUX_val)
            vp[:, 0] *= screen_w; vp[:, 1] *= screen_h
            yv = Y_val.clone(); yv[:, 0] *= screen_w; yv[:, 1] *= screen_h
            val_err = round(torch.sqrt(((vp - yv) ** 2).sum(dim=1)).mean().item(), 1)

        _neuralook_models[method] = model
        _neuralook_hidden[method] = None
        _neuralook_screen = (screen_w, screen_h, eye_w, eye_h)
        _nl_save_model(model, screen_w, screen_h, eye_w, eye_h, method)

        if os.path.exists(impl_path):
            os.remove(impl_path)

        improved = baseline_val_error is None or val_err < baseline_val_error
        _nl_append_refine_history(val_err, train_err, len(X_list), improved)

        for param in model.parameters():
            param.requires_grad = True

        _send({'id': req_id, 'event': 'done', 'data': {
            'improved': True, 'val_error_px': val_err,
            'train_error_px': train_err, 'samples': len(X_list),
        }})
    except ImportError:
        _send({'id': req_id, 'event': 'done', 'data': {'rejected': True, 'reason': 'PyTorch not installed'}})
    except Exception as e:
        _send({'id': req_id, 'event': 'done', 'data': {'rejected': True, 'reason': str(e)}})


def main():
    _send({'event': 'ready'})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        cmd = msg.get('cmd')
        req_id = msg.get('id', '')

        if cmd == 'shutdown':
            _send({'id': req_id, 'event': 'shutdown'})
            break
        elif cmd == 'train':
            t = threading.Thread(target=_handle_train, args=(msg, req_id), daemon=True)
            t.start()
        elif cmd == 'predict':
            _handle_predict(msg, req_id)
        elif cmd == 'reset-hidden':
            method = msg.get('method', 'cnn')
            _neuralook_hidden[method] = None
            _send({'id': req_id, 'event': 'done', 'data': {'ok': True}})
        elif cmd == 'auto-refine':
            t = threading.Thread(target=_handle_auto_refine, args=(msg, req_id), daemon=True)
            t.start()
        else:
            _send({'id': req_id, 'event': 'error', 'error': f'Unknown command: {cmd}'})


if __name__ == '__main__':
    main()
