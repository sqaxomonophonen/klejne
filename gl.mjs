import { assert, panic } from "./util.mjs";

export class GGL {
	constructor(gl) {
		assert(gl);
		this.gl = gl;
	}

	compile_shader(type, source) {
		const { gl } = this;
		const shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.error("compile error:\n" + gl.getShaderInfoLog(shader));
			console.error("SHADER SOURCE:\n"+source);
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	must_compile_shader(type, source) {
		const shader = this.compile_shader(type, source);
		assert(shader);
		return shader;
	}
}

export const MAKE_IS_QUADRANT = (varname) => [
	`(${varname} == 0 || ${varname} == 3)`,
	`(${varname} == 1)`,
	`(${varname} == 2 || ${varname} == 4)`,
	`(${varname} == 5)`,
];
