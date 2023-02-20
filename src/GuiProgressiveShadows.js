import { ProgressiveShadows } from "./ProgressiveShadows"

/**
 * Pass Lil or Dat gui to create control folder
 * @param {ProgressiveShadows} ps
 * @param {GUI} gui
 */
export function guiProgressiveShadows(ps, gui) {
  const folder = gui.addFolder("Progressive Shadows")
  folder.open()
  folder.add(ps.params, "enabled")
  folder.add(ps.params, "frames", 10, 500, 1).onFinishChange(() => {
    ps.recalculate()
  })
  folder.add(ps.params, "lightRadius", 0, 30, 0.1).onFinishChange(() => {
    ps.recalculate()
  })
  folder.add(ps.params, "ambientWeight", 0, 1, 0.1).onFinishChange(() => {
    ps.recalculate()
  })

  folder.addColor(ps.shadowCatcherMaterial, "color")
  folder.add(ps.shadowCatcherMaterial, "blend", 0, 2, 0.01)
  folder.add(ps.shadowCatcherMaterial, "opacity", 0, 1, 0.01)
  folder.add(ps.params, "alphaTest", 0, 1, 0.01).onChange((v) => {
    ps.shadowCatcherMaterial.alphaTest = v
  })
  folder.add(ps.params, "debugHelpers").onChange((v) => {
    ps.showDebugHelpers(v)
  })
  folder.add(ps, "recalculate")
  folder.add(ps, "clear")
  folder.add(ps, "progress", 0, 100, 1).listen().disable()
}
