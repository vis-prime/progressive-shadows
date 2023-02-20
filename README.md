# progressive-shadows

A vanilla js implementation of AccumulativeShadows from react three fiber

Based on

- LightMapping example by Zalo https://threejs.org/examples/?q=prog#webgl_shadowmap_progressive
- r3F drei's Accumulative Shadows https://github.com/pmndrs/drei/blob/master/src/core/AccumulativeShadows.tsx
- Development Forum post https://discourse.threejs.org/t/progressive-lightmap-as-floor-shadow-catcher/41429

Big thanks to drcmda/OxcaOa & r3f

## API Reference

#### Init

Class Files are available in `src` folder

```
progressiveShadows = new ProgressiveShadows(renderer, scene, { size: 4 })
```

#### After models are loaded , call clear which traverses scene and finds shadow casting meshes:

#### Move the object progressiveShadows.lightOrigin to control shadow direction:

```
progressiveShadows.lightOrigin.position.set(5,5,5)
```

```
progressiveShadows.clear()
```

#### In requestAnimationFrame loop add :

```
progressiveShadows.update(camera)
```

#### Gui for ProgressiveShadows

`guiProgressiveShadows` function can help add gui quickly for testing values

## Demo

[Simple](https://vis-prime.github.io/progressive-shadows/?scene=simple)

[RX7](https://vis-prime.github.io/progressive-shadows/?scene=rx7)
