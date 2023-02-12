import { shaderMaterial } from "./ShaderMaterial"

export const DiscardMaterial = shaderMaterial({}, "void main() { }", "void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); discard;  }")
