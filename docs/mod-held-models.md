# Held models for mod weapons

A held model is the weapon other players see in a character's hand. Its declaration does not replace a first-person viewmodel or take ownership of an original mod client scene.

QC, native Quake II Classic/rerelease, and QVM component weapon item definitions accept the same optional `held` value. The selected item's declaration travels with its source content identity through saves and unified network frames. Models resolve from that source's mounts.

```json
{
  "kind": "model",
  "model": {
    "path": "models/weapons/custom/held.md2",
    "referenceFrame": 0,
    "grip": {
      "origin": { "x": 1, "y": 2, "z": 3 },
      "axis": [
        { "x": 1, "y": 0, "z": 0 },
        { "x": 0, "y": 1, "z": 0 },
        { "x": 0, "y": 0, "z": 1 }
      ]
    }
  }
}
```

Replace the example coordinates with the actual grip in the authored model's reference frame. Axis columns give forward, left and up and must form an orthonormal, right-handed basis. Optional `scale` defaults to `{ "x": 1, "y": 1, "z": 1 }`; each component must be finite and nonzero. `referenceFrame` is an existing model animation frame. The renderer aligns that grip to the destination character's hand.

The model may include `digest: "sha256:<mesh SHA256>"` to require exact source bytes and `fallback: "another/held-model.md2"` for an authored alternative using the same reference coordinates. Quake MDL subsets may specify `part: { "digests": ["sha256:<mesh SHA256>"], "vertices": [0, 1, 2] }`; only complete triangles made from the declared vertices are retained.

To deliberately draw no held model, use:

```json
{ "kind": "none" }
```

This is an explicit source choice. A missing or invalid authored model does not silently become `none`.

If item metadata is unavailable, a source can put the same declaration in `<viewmodel path>.held.json`, with an additional `"version": 1`. For example, `<mod root>/models/weapons/custom/view.md2.held.json` can name `models/weapons/custom/held.md2`. The sidecar does not require loading or inventing a viewmodel. Per-item metadata takes precedence over the sidecar. Without an override, existing source weapon presentation and built-in held registrations continue to apply.

An original native Quake II player also needs a known animated attachment on its carrier model. Custom carrier geometry uses the separate `<carrier model path>.attachment.json` declaration. A held-model declaration describes the selected weapon's grip; an attachment declaration describes the destination hand. Neither model is inferred from a viewmodel's geometry.
