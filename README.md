NOTE: 
Updated version available here 
https://github.com/pmndrs/drei-vanilla?tab=readme-ov-file#accumulativeshadows


# progressive-shadows

A progressive/accumulative shadow catcher for three js which is a vanilla js implementation of AccumulativeShadows from react three fiber

Based on

- LightMapping example by Zalo https://threejs.org/examples/?q=prog#webgl_shadowmap_progressive
- r3F drei's Accumulative Shadows https://github.com/pmndrs/drei/blob/master/src/core/AccumulativeShadows.tsx
- Development Forum post https://discourse.threejs.org/t/progressive-lightmap-as-floor-shadow-catcher/41429

Big thanks to drcmda/OxcaOa , r3f and three js forums

## API Reference

Class Files are available in `src` folder

#### Init

```
progressiveShadows = new ProgressiveShadows(renderer, scene, { size: 4 })
```

#### After models are loaded , call clear which traverses scene and finds shadow casting meshes:

```
progressiveShadows.clear()
```

#### Move the object progressiveShadows.lightOrigin to control shadow direction:

```
progressiveShadows.lightOrigin.position.set(5,5,5)
```

#### In requestAnimationFrame loop add :

```
progressiveShadows.update(camera)
```

#### Gui for ProgressiveShadows

`guiProgressiveShadows` function can help add gui quickly for testing

## Demo

[Simple](https://vis-prime.github.io/progressive-shadows/?scene=simple)

[RX7](https://vis-prime.github.io/progressive-shadows/?scene=rx7)
