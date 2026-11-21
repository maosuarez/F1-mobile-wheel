"""Trazada ideal: desplazamiento lateral rl (m, + izquierda) que minimiza la curvatura² (design D2)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.optimize import minimize


def _normals(x: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Normal izquierda (nx, nz) = (tz, -tx), misma convención que samples.nx/nz."""
    tx = np.roll(x, -1) - np.roll(x, 1)
    tz = np.roll(z, -1) - np.roll(z, 1)
    m = np.hypot(tx, tz)
    return np.stack([tz / m, -tx / m], axis=1)


def _d2(p: np.ndarray) -> np.ndarray:
    return np.roll(p, -1, axis=0) - 2 * p + np.roll(p, 1, axis=0)


def curvature_sq(x: np.ndarray, z: np.ndarray, step: float = 2.0) -> float:
    """Σ curvatura² discreta (segunda diferencia / paso²)."""
    p = np.stack([x, z], axis=1)
    return float(np.sum((_d2(p) / step ** 2) ** 2))


def racing_line(x, z, wl, wr, margin: float = 1.2, iters: int = 3) -> np.ndarray:
    x, z = np.asarray(x, float), np.asarray(z, float)
    wl, wr = np.asarray(wl, float), np.asarray(wr, float)
    n = len(x)
    lo, hi = -wr + margin, wl - margin
    hi = np.maximum(hi, lo)  # ancho degenerado: rl = centro
    rl = np.zeros(n)
    n0 = _normals(x, z)  # normal fija: la curva desplazada p + rl·n es lineal en rl
    c = np.stack([x, z], axis=1)
    for _ in range(iters):
        # relinealización: la curvatura se normaliza con el paso de arco real de la curva actual
        q0 = c + rl[:, None] * n0
        ds = 0.5 * (np.hypot(*(np.roll(q0, -1, 0) - q0).T) + np.hypot(*(q0 - np.roll(q0, 1, 0)).T))
        w = (1.0 / ds ** 2)[:, None]

        def f(r):
            a = _d2(c + r[:, None] * n0) * w
            at = np.roll(a * w, 1, axis=0) - 2 * (a * w) + np.roll(a * w, -1, axis=0)
            return float(np.sum(a * a)), 2.0 * np.sum(at * n0, axis=1)

        res = minimize(f, rl, jac=True, method="L-BFGS-B", bounds=list(zip(lo, hi)),
                       options={"maxiter": 1000, "maxfun": 2000})
        rl = res.x
    # suavizado final (ventana 5, circular) y recorte a cotas
    k = np.ones(5) / 5
    ext = np.concatenate([rl[-2:], rl, rl[:2]])
    rl = np.convolve(ext, k, mode="valid")
    return np.clip(rl, lo, hi)


def _selftest() -> int:
    n, step = 400, 2.0
    L = n * step
    # óvalo (stadium-like): elipse 3:1 para curvas cerradas en los extremos
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    a, b = L / (2 * np.pi) * 1.5, L / (2 * np.pi) * 0.5
    x, z = a * np.cos(th), -b * np.sin(th)  # horario en (x,z): normal (tz,-tx) apunta al interior (= izquierda)
    # remuestreo uniforme
    seg = np.hypot(np.diff(np.r_[x, x[0]]), np.diff(np.r_[z, z[0]]))
    s = np.r_[0, np.cumsum(seg)][:-1]
    su = np.linspace(0, s[-1] + seg[-1], n, endpoint=False)
    x = np.interp(su, np.r_[s, s[-1] + seg[-1]], np.r_[x, x[0]])
    z = np.interp(su, np.r_[s, s[-1] + seg[-1]], np.r_[z, z[0]])
    wl = np.full(n, 7.0)
    wr = np.full(n, 7.0)
    rl = racing_line(x, z, wl, wr)
    nrm = _normals(x, z)
    px, pz = x + rl * nrm[:, 0], z + rl * nrm[:, 1]
    k0 = np.hypot(*(_d2(np.stack([x, z], 1)).T)) / np.mean(np.hypot(np.diff(x), np.diff(z))) ** 2
    ok = True
    assert rl.min() >= -wr[0] + 1.2 - 1e-9 and rl.max() <= wl[0] - 1.2 + 1e-9, "fuera de cotas"
    # signo de curvatura (antihorario => centro a la izquierda): en el punto de máxima curvatura rl > 0
    i = int(np.argmax(k0))
    mean_apex = rl[max(i - 10, 0):i + 10].mean()
    ok &= mean_apex > 1.0
    c0 = curvature_sq(x, z, step)
    c1 = curvature_sq(px, pz, step)
    red = 1 - c1 / c0
    ok &= red > 0.05
    print(f"{'OK' if ok else 'FAIL'} rl en [{rl.min():.2f},{rl.max():.2f}] apex rl={mean_apex:.2f} "
          f"curvatura² -{red * 100:.1f} %")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    print("uso: python -m tools.track.racing_line --selftest")
