import { MathUtils, ShaderMaterial, UniformsUtils } from "three"

export function shaderMaterial(uniforms = {}, vertexShader, fragmentShader, onInit = (material) => {}) {
  const material = class extends ShaderMaterial {
    constructor(parameters = {}) {
      const entries = Object.entries(uniforms)
      // Create uniforms and shaders
      super({
        uniforms: entries.reduce((acc, [name, value]) => {
          const uniform = UniformsUtils.clone({ [name]: { value } })
          return {
            ...acc,
            ...uniform,
          }
        }, {}),
        vertexShader,
        fragmentShader,
      })
      // Create getter/setters
      entries.forEach(([name]) =>
        Object.defineProperty(this, name, {
          get: () => this.uniforms[name].value,
          set: (v) => (this.uniforms[name].value = v),
        })
      )

      // Assign parameters, this might include uniforms
      Object.assign(this, parameters)
      // Call onInit
      if (onInit) onInit(this)
    }
  }
  material.key = MathUtils.generateUUID()
  return material
}
