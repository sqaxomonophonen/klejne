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
			console.error("compile error: " + gl.getShaderInfoLog(shader));
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
