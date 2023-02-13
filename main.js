import "./style.css"
import monkeyURL from "./public/monkey.glb?url"

const app = document.getElementById("app")
import { version } from "./package.json"
import Stats from "three/examples/jsm/libs/stats.module"
import { GUI } from "lil-gui"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { TransformControls } from "three/examples/jsm/controls/TransformControls"
import hdriUrl from "/public/aristea_wreck_1k.hdr?url"

import {
  ACESFilmicToneMapping,
  Color,
  EquirectangularReflectionMapping,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  sRGBEncoding,
  TextureLoader,
  Vector2,
  WebGLRenderer,
} from "three"
import { PSM } from "./ProgressiveShadowMap"
import { AccumulativeShadows } from "./AccumulativeShadows"
import { Vector3 } from "three"

let stats, renderer, camera, scene, controls, gui

let sphere, monkeyObj

const params = {
  envMapIntensity: 1,
}

let shadowMapObjects = []

init()

animate()

// doAccumulate()
doPSM()
// shaderMaterialTest()
async function doAccumulate() {
  const accShadows = new AccumulativeShadows(renderer, camera, scene, gui)

  // Sphere
  sphere = new Mesh(
    new SphereGeometry(0.5, 16, 16),
    new MeshStandardMaterial({ name: "sphereMat", color: 0xc0ffee, roughness: 0.1, metalness: 1 })
  )
  sphere.name = "sphere"
  sphere.castShadow = true
  sphere.receiveShadow = true
  sphere.position.set(2, 0.6, 2)
  scene.add(sphere)

  // Monkey !
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(monkeyURL)
  monkeyObj = gltf.scene
  monkeyObj.name = "monkey"
  monkeyObj.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  scene.add(monkeyObj)

  console.log({ accShadows, scene })
}

function init() {
  gui = new GUI({ title: "PSM " + version })
  gui.add(params, "envMapIntensity", 0, 1, 0.01).onChange(setEnvIntensity)

  stats = new Stats()
  app.appendChild(stats.dom)
  // renderer
  renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.outputEncoding = sRGBEncoding
  renderer.toneMapping = ACESFilmicToneMapping

  app.appendChild(renderer.domElement)

  // camera
  camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300)
  camera.position.set(-6, 4, 4)
  camera.name = "Camera"

  // scene
  scene = new Scene()
  scene.background = new Color(0x949494)

  const rgbeLoader = new RGBELoader()
  rgbeLoader.load(hdriUrl, (texture) => {
    texture.mapping = EquirectangularReflectionMapping
    scene.background = texture
    scene.backgroundBlurriness = 0.8
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

function animate() {
  requestAnimationFrame(animate)
  render()
}

function setEnvIntensity() {
  scene.backgroundIntensity = params.envMapIntensity
  scene.traverse((node) => {
    if (node.material && node.material.isMeshStandardMaterial) {
      node.material.envMapIntensity = params.envMapIntensity
    }
  })
}

async function doPSM() {
  // Sphere
  sphere = new Mesh(
    new SphereGeometry(0.5, 16, 16),
    new MeshStandardMaterial({ name: "sphereMat", color: 0xc0ffee, roughness: 0, metalness: 1 })
  )
  sphere.name = "sphere"
  sphere.castShadow = true
  sphere.receiveShadow = true
  sphere.position.set(1, 0.6, 1)
  scene.add(sphere)

  // Monkey !
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(monkeyURL)
  monkeyObj = gltf.scene
  monkeyObj.name = "monkey"
  monkeyObj.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
      shadowMapObjects.push(child)
    }
  })
  scene.add(monkeyObj)

  shadowMapObjects.push(sphere)

  initProgressiveShadows()
}

async function initProgressiveShadows() {
  // light position gizmo
  const control = new TransformControls(camera, renderer.domElement)
  control.name = "lightOrigin control"
  control.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
    if (!event.value) {
      psm.shadowColor.setHSL(Math.random(), 1, 0.5)
      psm.update()
    }
  })
  scene.add(control)

  // sphere position gizmo
  const control2 = new TransformControls(camera, renderer.domElement)
  control2.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
    if (!event.value) {
      psm.shadowColor.setHSL(Math.random(), 0.5, 0.5)

      psm.update()
    }
  })
  const planeSize = 5 / 2
  const clampMin = new Vector3(-planeSize, 0, -planeSize),
    clampMax = new Vector3(planeSize, planeSize, planeSize)
  control2.addEventListener("change", (event) => {
    sphere.position.clamp(clampMin, clampMax)
  })
  control2.name = "control sphere"
  scene.add(control2)
  control2.attach(sphere)
  control2.size = 1

  // psm stuff
  const psm = new PSM(renderer, camera, scene)
  control.attach(psm.lightOrigin)

  psm.addObjectsToLightMap(shadowMapObjects)
  console.log({ psm })

  gui.add(psm.params, "enable")
  gui.add(psm.params, "frames", 10, 500, 1)
  gui.add(psm.params, "updateDelay", 1, 100, 1)
  gui.add(psm.params, "blendWindow", 1, 500, 1)
  gui.add(psm.params, "lightRadius", 0, 30, 0.1)
  gui.add(psm.params, "ambientWeight", 0, 1, 0.1)
  gui.addColor(psm, "shadowColor").listen()
  gui.add(psm, "progress", 0, 100, 1).listen().disable()
  gui.add(psm.shadowCatcherMesh.material, "blend", 0, 2, 0.01)
  gui
    .add(psm.params, "opacity", 0, 1, 0.01)

    .onChange((v) => {
      psm.shadowCatcherMesh.material.opacity = v
    })

  gui.add(psm.params, "debugMap").onChange((v) => {
    psm.showDebugLightmap(v)
  })
  gui.add(psm, "update")

  setTimeout(() => {
    psm.update()
  }, 1000)
}

// function shaderMaterialTest() {
//   const vShader = `
// varying vec2 vUv;

// void main() {
//   vUv = uv;

//   gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
// }
// `
//   const fShader = `
// varying vec2 vUv;

// uniform sampler2D u_tex;

// void main()
// {

//   vec4 textureColor = texture2D(u_tex, vUv);

//   textureColor.a = (textureColor.r + textureColor.g + textureColor.b) / 3.0;

//   gl_FragColor = textureColor;

// }
// `

//   const geometry = new PlaneGeometry(1, 1)
//   const uniforms = {
//     u_tex: { value: new TextureLoader().load("./public/radial_gradient.jpg") },
//     u_adjust_uv: { value: new Vector2(1, 16 / 9) },
//   }
//   const material = new ShaderMaterial({
//     uniforms: uniforms,
//     vertexShader: vShader,
//     fragmentShader: fShader,
//     transparent: true,
//     alphaTest: 0.8,
//   })

//   const plane = new Mesh(geometry, material)
//   plane.position.y = 2
//   scene.add(plane)
// }
