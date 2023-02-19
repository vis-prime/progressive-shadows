import "./style.css"
import { initRx7 } from "./demo/RX7"
import { initSimple } from "./demo/Simple"
import { version, name } from "./package.json"
import { GUI } from "lil-gui"
// import { initRelease } from "./demo/Release"

let url_string = window.location.href
let url = new URL(url_string)
const AllScenes = {
  RX7: "rx7",
  Simple: "simple",
  // Release: "release",
}
const params = {
  sceneName: url.searchParams.get("scene") || AllScenes.Simple,
}

function getKeyByValue(object, value) {
  return Object.keys(object).find((key) => object[key] === value)
}

function updatePageDesc(path) {
  const prettyName = getKeyByValue(AllScenes, path)
  const paramsU = new URLSearchParams(window.location.search)
  paramsU.set("scene", path)
  window.history.replaceState({}, "", `${window.location.pathname}?${paramsU}`)
  document.title = `Progressive Shadows | ${prettyName}`
}
const gui = new GUI({ title: "PSM " + version, closeFolders: true })
gui
  .add(params, "sceneName", AllScenes)
  .name("SCENE")
  .onChange((v) => {
    updatePageDesc(v)
    window.location.reload()
  })

function loadScene(path) {
  switch (path.toLowerCase()) {
    case AllScenes.RX7: {
      initRx7(gui)
      updatePageDesc(AllScenes.RX7)
      break
    }

    case AllScenes.Simple: {
      initSimple(gui)
      updatePageDesc(AllScenes.Simple)
      break
    }

    // case AllScenes.Release: {
    //   initRelease(gui)
    //   updatePageDesc(AllScenes.Release)
    //   break
    // }

    default: {
      console.warn("invalid scene")
      break
    }
  }
}

loadScene(params.sceneName)
