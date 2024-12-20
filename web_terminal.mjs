import { make_font_atlas, AtlasFont } from "./webworkerlib_graphics.mjs";
import { assert, panic } from "./util.mjs";
import { image_bitmap_to_image, u8arr_bitmap_to_image } from './web_tools.mjs';
import { GGL, IS_QUADRANT } from './gl.mjs';

const U32S_PER_QUAD = 5
const QUADS_UTEX_WIDTH_LOG2 = 10;
const QUADS_UTEX_WIDTH = 1 << QUADS_UTEX_WIDTH_LOG2;
const QUADS_PER_ROW = (QUADS_UTEX_WIDTH/(4*U32S_PER_QUAD))|0;
const MIN_QUADS_UTEX_ROWCAP_LOG2 = 7;

class WebTerminal {
	constructor() {
		this.root_element = null;
		this.atlas = null;
		this.atlas_tex = null;
		this.please_update_atlas_texture = false;
	}

	setup_gl() {
		const gl = this.gl = this.canvas.getContext("webgl2");
		if (this.gl === null) panic("failed to get webgl2 context");
		const ggl = this.ggl = new GGL(this.gl);

		this.quads_utex_rowcap_log2 = undefined;

		this.atlas_tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.atlas_tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

		const vertex_shader = ggl.must_compile_shader(gl.VERTEX_SHADER, `#version 300 es
		precision highp float;

		uniform highp usampler2D u_quads;
		uniform vec2 u_fb_dim;
		uniform vec2 u_tex_dim;

		out vec4 v_rgba;
		out vec2 v_uv;

		vec2 unpack_uvec4_to_vec2(uvec4 v)
		{
			return vec2(float(v.x)+256.0*float(v.y), float(v.z)+256.0*float(v.w));
		}

		vec2 norm(vec2 v)
		{
			return v*2.0-1.0;
		}

		void main()
		{
			int quad_index = gl_VertexID / 6;
			int ix = (quad_index % ${QUADS_PER_ROW}) * ${U32S_PER_QUAD};
			int iy = (quad_index / ${QUADS_PER_ROW});
			uvec4 raw_xy0  = texelFetch(u_quads, ivec2(ix+0,iy), 0);
			uvec4 raw_xy1  = texelFetch(u_quads, ivec2(ix+1,iy), 0);
			uvec4 raw_uv0  = texelFetch(u_quads, ivec2(ix+2,iy), 0);
			uvec4 raw_uv1  = texelFetch(u_quads, ivec2(ix+3,iy), 0);
			uvec4 raw_rgba = texelFetch(u_quads, ivec2(ix+4,iy), 0);
			float csc = 1.0 / 255.0;
			v_rgba = vec4(float(raw_rgba.x)*csc, float(raw_rgba.y)*csc, float(raw_rgba.z)*csc, float(raw_rgba.w)*csc);
			vec2 xy0 = norm(unpack_uvec4_to_vec2(raw_xy0) / u_fb_dim);
			vec2 xy1 = norm(unpack_uvec4_to_vec2(raw_xy1) / u_fb_dim);

			vec2 uv0 = unpack_uvec4_to_vec2(raw_uv0) / u_tex_dim;
			vec2 uv1 = unpack_uvec4_to_vec2(raw_uv1) / u_tex_dim;
			vec2 xy;
			if (${IS_QUADRANT[0]}) {
				xy = vec2(xy0.x,xy0.y);
				v_uv = vec2(uv0.x,uv0.y);
			} else if (${IS_QUADRANT[1]}) {
				xy = vec2(xy1.x,xy0.y);
				v_uv = vec2(uv1.x,uv0.y);
			} else if (${IS_QUADRANT[2]}) {
				xy = vec2(xy1.x,xy1.y);
				v_uv = vec2(uv1.x,uv1.y);
			} else if (${IS_QUADRANT[3]}) {
				xy = vec2(xy0.x,xy1.y);
				v_uv = vec2(uv0.x,uv1.y);
			}
			gl_Position = vec4(xy,0,1);
		}
		`);

		const fragment_shader = ggl.must_compile_shader(gl.FRAGMENT_SHADER, `#version 300 es
		precision highp float;
		uniform sampler2D u_tex;
		in vec4 v_rgba;
		in vec2 v_uv;
		out vec4 frag_color;
		void main()
		{
			frag_color = texture(u_tex, v_uv).r * v_rgba;
		}
		`);

		const program = gl.createProgram();
		gl.attachShader(program, vertex_shader);
		gl.attachShader(program, fragment_shader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			const info = gl.getProgramInfoLog(program);
			panic(`shader linking failed ${info}`);
		}

		// no longer needed
		gl.deleteShader(vertex_shader);
		gl.deleteShader(fragment_shader);

		this.u_quads   = gl.getUniformLocation(program, "u_quads");
		this.u_fb_dim  = gl.getUniformLocation(program, "u_fb_dim");
		this.u_tex_dim = gl.getUniformLocation(program, "u_tex_dim");
		this.u_tex     = gl.getUniformLocation(program, "u_tex");
		this.program   = program;
	}

	mount(root_element) {
		assert(this.root_element === null, "already mounted");
		this.root_element = root_element;
		this.canvas = document.createElement("canvas");
		this.setup_gl();
		this.root_element.appendChild(this.canvas);
		this.render();
	}

	unmount() {
		assert(this.root_element !== null, "not mounted");
		assert(this.canvas);
		this.root_element.removeChild(this.canvas);
		this.gl = null;
		this.canvas = null;
		this.root_element = null;
	}

	set_atlas_font(atlas_font) {
		return new Promise((resolve, reject) => {
			make_font_atlas(atlas_font).then((r) => {
				const { atlas } = r;
				u8arr_bitmap_to_image(atlas.width, atlas.height, atlas.bitmap).then(b => {
					const img = image_bitmap_to_image(b);
					document.body.appendChild(img);
				});
				this.atlas = atlas;
				this.glyphdim = r.glyphdim;
				this.please_update_atlas_texture = true;
				resolve(true);
			}).catch(reject);
		});
	}

	render() {
		const gl = this.gl;
		if (!gl) return;

		if (this.please_update_atlas_texture) {
			gl.bindTexture(gl.TEXTURE_2D, this.atlas_tex);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0, // level
				gl.LUMINANCE,
				this.atlas.width,
				this.atlas.height,
				0, // border
				gl.LUMINANCE,
				gl.UNSIGNED_BYTE,
				this.atlas.bitmap);
			this.please_update_atlas_texture = false;
		}

		const canvas = this.canvas;
		const width  = canvas.width  = canvas.offsetWidth;
		const height = canvas.height = canvas.offsetHeight;

		const gd = this.glyphdim;
		assert(gd && gd.width>0 && gd.height>0);
		const num_rows = Math.floor(height / gd.height);
		const num_cols = Math.floor(width  / gd.width);
		const req_quads = num_cols * num_rows;

		{
			let do_tex_image = false;
			if (this.quads_utex_rowcap_log2 === undefined) {
				this.quads_utex_rowcap_log2 = MIN_QUADS_UTEX_ROWCAP_LOG2;
				do_tex_image = true;
			}
			while (req_quads > (QUADS_PER_ROW << this.quads_utex_rowcap_log2)) {
				this.quads_utex_rowcap_log2++;
				do_tex_image = true;
			}
			if (do_tex_image) {
				if (this.quads_utex) gl.deleteTexture(this.quads_utex);
				this.quads_utex = gl.createTexture();
				gl.bindTexture(gl.TEXTURE_2D, this.quads_utex);
				gl.texStorage2D(
					gl.TEXTURE_2D,
					1,
					gl.RGBA8UI,
					QUADS_UTEX_WIDTH,
					1 << this.quads_utex_rowcap_log2);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			}

			const utex_height = ((req_quads + QUADS_PER_ROW - 1) / QUADS_PER_ROW) | 0;
			let data = new Uint8Array(4*QUADS_UTEX_WIDTH*utex_height);

			data[0] = 0;
			data[2] = 0;
			data[4] = 100;
			data[6] = 100;

			data[8]  = 0;
			data[10] = 0;
			data[12] = 100;
			data[14] = 100;

			data[16] = 255;
			data[17] = 128;
			data[18] = 255;
			data[19] = 255;

			gl.bindTexture(gl.TEXTURE_2D, this.quads_utex);
			gl.texSubImage2D(
				gl.TEXTURE_2D,
				0, // level
				0, 0, // x/y offset
				QUADS_UTEX_WIDTH,
				utex_height,
				gl.RGBA_INTEGER,
				gl.UNSIGNED_BYTE,
				data);
		}

		gl.clearColor(0,0,0.4,1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(this.program);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.quads_utex);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.atlas_tex);

		gl.uniform1i(this.u_quads, 0);
		gl.uniform1i(this.u_tex,   1);
		gl.uniform2f(this.u_fb_dim,  width, height);
		gl.uniform2f(this.u_tex_dim, QUADS_UTEX_WIDTH, 1 << this.quads_utex_rowcap_log2);

		gl.drawArrays(gl.TRIANGLES, 0, 6);

		if (this.root_element !== null) window.requestAnimationFrame(_=>this.render());
	}
}

export const create_web_terminal = (atlas_font) => new Promise((resolve, reject) => {
	if (!atlas_font) atlas_font = new AtlasFont();
	const t = new WebTerminal();
	t.set_atlas_font(atlas_font).then(_=>{
		resolve(t);
	}).catch(reject);
});
