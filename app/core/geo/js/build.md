# Build-time configuration

Unlike world_config.json, this value cannot be read at runtime - it must
be passed to the emscripten linker when generator.cpp is compiled.

## INITIAL_MEMORY

Recommended: `128 MB`

```
emcc ... -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=134217728 ...
```

Sizing basis (see the 5-buffer SoA layout in geo_layout.hpp):
- 5 buffers x 2 bytes x cell count, plus the transient `g_visited` and
  `g_waterDist` scratch buffers (now reused across calls, not
  reallocated - see water_gen.cpp / urban_gen.cpp).
- A 4,000,000-cell map (e.g. 2000x2000) needs roughly 65-70 MB with
  scratch buffers included.
- 128 MB leaves headroom for larger maps and allocator overhead without
  triggering ALLOW_MEMORY_GROWTH during normal generation - avoiding
  growth in the common case is what keeps GeoManager/UrbanManager's
  buffer-detach handling (see their own header comments) a safety net
  rather than something that fires on every run.

If a larger max map size is planned, recompute from the same basis above
and raise this value accordingly - it is cheaper to over-provision this
number than to hit a mid-generation growth event on a large map.
