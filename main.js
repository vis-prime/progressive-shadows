import "./style.css"
import monkey from "./public/monkey.glb?url"

const app = document.getElementById("app")
import Stats from "three/addons/libs/stats.module"
import { GUI } from "three/examples/jsm/libs/lil-gui.module.min"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { TransformControls } from "three/examples/jsm/controls/TransformControls"
import { ProgressiveLightMap } from "./ProgressiveLightMap"
import moonless_golf_1k from "/public/moonless_golf_1k.hdr?url"

import {
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Group,
  Mesh,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  sRGBEncoding,
  WebGLRenderer,
} from "three"
import { PSM } from "./PSM"

// ShadowMap + LightMap Res and Number of Directional Lights
const shadowMapRes = 512,
  lightMapRes = 1024,
  lightCount = 8
let camera,
  stats,
  scene,
  renderer,
  controls,
  control,
  control2,
  object = new Mesh(),
  lightOrigin = null,
  progressiveSurfaceMap
const dirLights = [],
  lightmapObjects = []
const params = {
  Enable: true,
  "Blur Edges": true,
  "Blend Window": 200,
  "Light Radius": 5,
  "Ambient Weight": 0.5,
  "Debug Lightmap": false,
}
init()

animate()

// PLM()
doPSM()

console.log(scene)

function init() {
  stats = new Stats()
  app.appendChild(stats.dom)
  // renderer
  renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.outputEncoding = sRGBEncoding

  app.appendChild(renderer.domElement)

  // camera
  camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300)
  camera.position.set(0, 5, 5)
  camera.name = "Camera"

  // scene
  scene = new Scene()
  scene.background = new Color(0x949494)

  const rgbeLoader = new RGBELoader()
  rgbeLoader.load(moonless_golf_1k, (texture) => {
    texture.mapping = EquirectangularReflectionMapping
    scene.background = texture
    // scene.backgroundBlurriness = 0.2
    scene.environment = texture
  })

  // controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true // an animation loop is required when either damping or auto-rotation are enabled
  controls.dampingFactor = 0.05
  // controls.screenSpacePanning = true
  controls.minDistance = 0.1
  controls.maxDistance = 100
  controls.maxPolarAngle = Math.PI / 1.5
  controls.target.set(0, 0, 0)
  window.addEventListener("resize", onWindowResize)
}

function PLM() {
  createGUI()
  // progressive lightmap
  progressiveSurfaceMap = new ProgressiveLightMap(renderer, lightMapRes)
  console.log({ progressiveSurfaceMap })

  // directional lighting "origin"
  lightOrigin = new Group()
  lightOrigin.name = "lightOrigin"
  lightOrigin.position.set(6, 15, 10)
  scene.add(lightOrigin)

  // transform gizmo
  control = new TransformControls(camera, renderer.domElement)
  control.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
  })
  control.attach(lightOrigin)
  scene.add(control)
  control.name = "control"

  // create 8 directional lights to speed up the convergence
  for (let l = 0; l < lightCount; l++) {
    const dirLight = new DirectionalLight(0xffffff, 1.0 / lightCount)
    dirLight.name = "Dir. Light " + l
    dirLight.position.set(2, 2, 2)
    dirLight.castShadow = true
    dirLight.shadow.camera.near = 0.1
    dirLight.shadow.camera.far = 100
    dirLight.shadow.camera.right = 5
    dirLight.shadow.camera.left = -5
    dirLight.shadow.camera.top = 5
    dirLight.shadow.camera.bottom = -5
    dirLight.shadow.mapSize.width = shadowMapRes
    dirLight.shadow.mapSize.height = shadowMapRes
    lightmapObjects.push(dirLight)
    dirLights.push(dirLight)
  }

  // ground
  const groundMesh = new Mesh(
    new PlaneGeometry(6, 6),
    new MeshStandardMaterial({
      color: 0xffffff,
    })
  )
  groundMesh.position.y = 0
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.name = "groundMesh"
  lightmapObjects.push(groundMesh)
  scene.add(groundMesh)

  control2 = new TransformControls(camera, renderer.domElement)
  control2.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
  })
  control2.name = "control2"
  scene.add(control2)

  // Monkey
  const loader = new GLTFLoader()
  loader.load(monkey, (obj) => {
    obj.scene.name = "monkey"
    obj.scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        child.material = new MeshPhongMaterial()
        // This adds the model to the lightmap
        lightmapObjects.push(child)
        progressiveSurfaceMap.addObjectsToLightMap(lightmapObjects)
      }
    })
    control2.attach(obj.scene)
    scene.add(obj.scene)

    const lightTarget = new Group()
    lightTarget.position.set(0, 0.2, 0)
    for (let l = 0; l < dirLights.length; l++) {
      dirLights[l].target = lightTarget
    }
    obj.scene.add(lightTarget)
  })

  console.log(progressiveSurfaceMap)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createGUI() {
  const gui = new GUI({ name: "Accumulation Settings" })
  const guiParams = {
    acc: accumulate,
    clear: clear,
  }
  gui.add(params, "Enable")
  gui.add(params, "Blur Edges")
  gui.add(params, "Blend Window", 1, 500).step(1)
  gui.add(params, "Light Radius", 0, 100).step(0.1)
  gui.add(params, "Ambient Weight", 0, 1).step(0.1)
  gui.add(params, "Debug Lightmap").onChange(() => {
    progressiveSurfaceMap.showDebugLightmap(params["Debug Lightmap"])
  })
  gui.add(guiParams, "acc")
  gui.add(guiParams, "clear")
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function render() {
  stats.update()
  // Update the inertia on the orbit controls
  controls.update()

  // Render Scene
  renderer.render(scene, camera)
}

async function accumulate() {
  // Accumulate Surface Maps
  console.log("Accumulate start...")
  for (let index = 0; index < 600; index++) {
    await sleep(1)

    if (params["Enable"]) {
      progressiveSurfaceMap.update(camera, params["Blend Window"], params["Blur Edges"])
    }

    // Manually Update the Directional Lights
    for (let l = 0; l < dirLights.length; l++) {
      // Sometimes they will be sampled from the target direction
      // Sometimes they will be uniformly sampled from the upper hemisphere
      if (Math.random() > params["Ambient Weight"]) {
        dirLights[l].position.set(
          lightOrigin.position.x + Math.random() * params["Light Radius"],
          lightOrigin.position.y + Math.random() * params["Light Radius"],
          lightOrigin.position.z + Math.random() * params["Light Radius"]
        )
      } else {
        // Uniform Hemispherical Surface Distribution for Ambient Occlusion
        const lambda = Math.acos(2 * Math.random() - 1) - 3.14159 / 2.0
        const phi = 2 * 3.14159 * Math.random()
        dirLights[l].position.set(
          Math.cos(lambda) * Math.cos(phi) * 3 + object.position.x,
          Math.abs(Math.cos(lambda) * Math.sin(phi) * 3) + object.position.y + 2,
          Math.sin(lambda) * 3 + object.position.z
        )
      }
    }
  }
  console.log("Accumulate end")
}

function clear() {
  progressiveSurfaceMap.progressiveLightMap1.dispose()
  progressiveSurfaceMap.progressiveLightMap2.dispose()
}

function animate() {
  requestAnimationFrame(animate)
  render()
}

async function doPSM() {
  const objArray = []
  // directional lighting "origin"
  lightOrigin = new Group()
  lightOrigin.name = "lightOrigin"
  lightOrigin.position.set(5, 5, 5)
  scene.add(lightOrigin)

  // light position gizmo
  control = new TransformControls(camera, renderer.domElement)
  control.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
  })
  control.attach(lightOrigin)
  scene.add(control)
  control.name = "lightOrigin control"

  const psm = new PSM(renderer, camera)

  // create 8 directional lights to speed up the convergence
  for (let l = 0; l < psm.lightCount; l++) {
    const dirLight = new DirectionalLight(0xffffff, 1.0 / psm.lightCount)
    dirLight.name = "Dir. Light " + l
    dirLight.position.set(2, 2, 2)
    dirLight.castShadow = true
    dirLight.shadow.camera.near = 0.1
    dirLight.shadow.camera.far = 100
    dirLight.shadow.camera.right = 5
    dirLight.shadow.camera.left = -5
    dirLight.shadow.camera.top = 5
    dirLight.shadow.camera.bottom = -5
    dirLight.shadow.mapSize.width = psm.shadowMapRes
    dirLight.shadow.mapSize.height = psm.shadowMapRes
    psm.dirLights.push(dirLight)
    objArray.push(dirLight)
  }

  const gui = new GUI({ name: "PSM" })
  psm.addGui(gui)
  // ground
  const groundMesh = new Mesh(
    new PlaneGeometry(6, 6),
    new MeshStandardMaterial({
      color: 0xffffff,
      name: "groundMat",
    })
  )
  objArray.push(groundMesh)
  groundMesh.position.y = 0
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.name = "groundMesh"
  groundMesh.receiveShadow = true

  scene.add(groundMesh)

  const sphere = new Mesh(
    new SphereGeometry(0.5, 12, 12),
    new MeshStandardMaterial({ name: "sphereMat", color: 0xc0ffee, roughness: 0, metalness: 1 })
  )
  sphere.name = "sphere"
  sphere.castShadow = true
  sphere.receiveShadow = true

  objArray.push(sphere)
  sphere.position.set(1, 0.6, 1)
  scene.add(sphere)

  psm.lightOrigin = lightOrigin
  psm.object = sphere

  control2 = new TransformControls(camera, renderer.domElement)
  control2.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
  })
  control2.name = "control sphere"
  scene.add(control2)
  control2.attach(sphere)
  control2.size = 0.3

  // Monkey
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(monkey)

  gltf.scene.name = "monkey"
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
      child.material.roughness = 0.2
      // This adds the model to the lightmap
      lightmapObjects.push(child)
      psm.object = child
      objArray.push(child)
      // progressiveSurfaceMap.addObjectsToLightMap(lightmapObjects)
    }
  })

  const lightTarget = new Group()
  lightTarget.position.set(0, 0.2, 0)
  for (let l = 0; l < psm.dirLights.length; l++) {
    psm.dirLights[l].target = lightTarget
  }
  sphere.add(lightTarget)

  scene.add(gltf.scene)

  psm.addObjectsToLightMap(objArray)

  console.log({ psm })
}
