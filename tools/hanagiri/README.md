# Hanagiri Pass — how the map data was made (Phase 5A)

These scripts turned the mountain layout (`gt-racing-scandinavia-mountains.zip`) into the data in
`src/world/hanagiri/data.ts`. Only the shape of the land and the roads is used. The pack's
textures, banners, logos and models are not shipped, and nothing from the zip is in this repo.
Everything you see in the game (houses, the shrine, torii, trees, signs, snow and petals) is drawn
in code.

You only need these scripts to rebuild the data. The game itself just reads `data.ts`.

## Needs

- Python 3 with numpy, scipy, scikit-image and Pillow
- Blender (to dump the meshes), or assimp to convert the FBX to glb first
- The zip, unpacked somewhere outside the repo

## Steps

Each step writes into `/tmp/h/` and the next one reads from there.

0. **Mesh dump.** Convert the layout to glb (`assimp export layout_1.fbx layout.glb`). Then use a
   short Blender script to save each mesh's vertices and faces as `/tmp/map/meshes.npz`, with keys
   `<name>_V` and `<name>_F`. In the source, `6400_node_1` is the road, `6000` is the snowy ground
   and `6401` is the rock.
1. **`road.py`** draws the road mesh onto a 1 m grid (a mask plus the road height). It then thins
   the mask down to its centre lines (the skeleton).
2. **`graph.py`** turns the skeleton into a graph of road pieces: the junctions and the edges
   between them.
3. **`lap.py`** picks the edges that make the longest closed lap. Almost every road in the layout is
   used. The script also draws a preview at `/tmp/h/lap.png`.
4. **`terrain_src.py`** draws the ground and rock meshes onto a 2 m grid, in the source's
   coordinates. It also finds the house footprints.
5. **`gen.py`** joins the lap pieces and adds the two new link roads (Hermite curves). It smooths
   the line, checks it, and scales it 1.75× (the village straight becomes y = 0). The minimum
   radius is 25 m, no two parts of the lap come within 45 m, and the grades stay within about ±15 %.
6. **`gen2.py`** builds the final data:
   - control points about every 20 m;
   - the 4 m height field, with the road cut into it (a flat shoulder out to 18 m, blending out to
     50 m), with gaps filled by normalized convolution;
   - the houses.

   It writes `/tmp/h/hanagiri.json`. That file becomes `src/world/hanagiri/data.ts`: the height
   field is stored as row deltas in uint16, zlib-compressed and base64-encoded.

## Checks

`npm run test:physics` runs these checks on the result:

- the lap is longer than 10 km and climbs more than 120 m;
- no two parts of the lap come within 40 m;
- the road height is exact, and there is no step where the road meets the land;
- a robot driver completes a lap, and so do eight AI cars;
- the pursuit works: a ridge between two parts of the road hides you, and Air One stays clear of
  the land.
