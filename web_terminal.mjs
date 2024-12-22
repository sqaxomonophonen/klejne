import { make_font_atlas, AtlasFont } from "./webworkerlib_graphics.mjs";
import { assert, panic } from "./util.mjs";
import { image_bitmap_to_image, u8arr_bitmap_to_image } from './web_tools.mjs';
import { GGL, MAKE_IS_QUADRANT } from './gl.mjs';
import WebGL2CanvasUnfuck from './web_webgl2canvas_unfuck.mjs';
import make_fps from './fps.mjs';

const WORDS_PER_QUAD = 5
const QUADS_UTEX_WIDTH_LOG2 = 9;
const QUADS_UTEX_WIDTH = 1 << QUADS_UTEX_WIDTH_LOG2;
const QUADS_PER_ROW = 0|(QUADS_UTEX_WIDTH/WORDS_PER_QUAD);
const MIN_QUADS_UTEX_ROWCAP_LOG2 = 7;

class WebTerminal {
	constructor() {
		this.root_element = null;
		this.atlas = null;
		this.atlas_tex = null;
		this.please_update_atlas_texture = false;
		this.unfuck = new WebGL2CanvasUnfuck((unfuck) => this.setup_gl(unfuck));
		this.fps = make_fps();
	}

	setup_gl(unfuck) {
		const gl = this.gl = unfuck.gl;
		this.canvas = unfuck.canvas;
		const ggl = this.ggl = new GGL(this.gl);

		this.quads_utex_rowcap_log2 = undefined;

		this.atlas_tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.atlas_tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

		const IS_QUADRANT = MAKE_IS_QUADRANT("quad_vertex_index");
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
			return v * vec2(2,-2) + vec2(-1,1);
		}

		void main()
		{
			int quad_index        = gl_VertexID / 6;
			int quad_vertex_index = gl_VertexID % 6;
			int ix = (quad_index % ${QUADS_PER_ROW}) * ${WORDS_PER_QUAD};
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
				xy   = vec2(xy0.x,xy0.y);
				v_uv = vec2(uv0.x,uv0.y);
			} else if (${IS_QUADRANT[1]}) {
				xy   = vec2(xy1.x,xy0.y);
				v_uv = vec2(uv1.x,uv0.y);
			} else if (${IS_QUADRANT[2]}) {
				xy   = vec2(xy1.x,xy1.y);
				v_uv = vec2(uv1.x,uv1.y);
			} else if (${IS_QUADRANT[3]}) {
				xy   = vec2(xy0.x,xy1.y);
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

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE,gl.ONE);

		this.please_update_atlas_texture = true;
	}

	mount(root_element) {
		if (this.unfuck.mount(root_element)) {
			this.render();
		}
	}

	unmount() {
		this.unfuck.unmount();
	}

	set_atlas_font(atlas_font) {
		return new Promise((resolve, reject) => {
			make_font_atlas(atlas_font).then((atlas) => {
				this.atlas = atlas;
				/*
				u8arr_bitmap_to_image(atlas.image.width, atlas.image.height, atlas.image.data).then(b => {
					const img = image_bitmap_to_image(b);
					document.body.appendChild(img);
				});
				*/
				this.please_update_atlas_texture = true;
				resolve(true);
			}).catch(reject);
		});
	}

	render() {
		const gl = this.gl;

		const { glyphdim, passes, lookup } = this.atlas
		const atlas_image = this.atlas.image;

		if (this.please_update_atlas_texture && this.atlas) {
			gl.bindTexture(gl.TEXTURE_2D, this.atlas_tex);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0, // level
				gl.LUMINANCE,
				atlas_image.width,
				atlas_image.height,
				0, // border
				gl.LUMINANCE,
				gl.UNSIGNED_BYTE,
				atlas_image.data);
			this.please_update_atlas_texture = false;
		}

		const canvas = this.canvas;
		const width  = canvas.width  = canvas.offsetWidth;
		const height = canvas.height = canvas.offsetHeight;

		assert(glyphdim && glyphdim.width>0 && glyphdim.height>0);
		const num_rows = Math.floor(height / glyphdim.height);
		const num_cols = Math.floor(width  / glyphdim.width);
		const num_cells = num_cols * num_rows;
		const max_quads = num_cells * passes.length;

		let do_tex_image = false;
		if (this.quads_utex_rowcap_log2 === undefined) {
			this.quads_utex_rowcap_log2 = MIN_QUADS_UTEX_ROWCAP_LOG2;
			do_tex_image = true;
		}
		while (max_quads > (QUADS_PER_ROW << this.quads_utex_rowcap_log2)) {
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

		const utex_height = ((max_quads + QUADS_PER_ROW - 1) / QUADS_PER_ROW) | 0;
		let data = new Uint8Array(4*QUADS_UTEX_WIDTH*utex_height);

		let di = 0;
		let num_quads = 0;
		const num_passes = passes.length;
		for (let row=0; row<num_rows; ++row) {
			const cursor_y = row*glyphdim.height;
			for (let col=0; col<num_cols; ++col) {
				const cursor_x = col*glyphdim.width;
				//const cp = ((row^col)&1) ? 49 : 50; // XXX read from "terminal screen buffer"
				const cp = 33+col + row;
				if (cp < 32) continue; // skip control codes
				const lu = lookup[cp];
				if (!lu) continue; // skip missing glyphs

				for (let pass=0; pass<num_passes; ++pass) {
					const l = lu[pass];
					const dx0 = 0;
					const dy0 = 0;
					const dx1 = l.w;
					const dy1 = l.h;
					const v16s=[
						/*xy0*/ cursor_x+dx0, cursor_y+dy0,
						/*xy1*/ cursor_x+dx1, cursor_y+dy1,
						/*uv0*/ l.x     , l.y     ,
						/*uv1*/ l.x+l.w , l.y+l.h ,
					];
					// pack (unpack?) u16 values into u8 values
					for (let j=0; j<8; j++) {
						const v16 = v16s[j];
						const lo = v16&255;
						const hi = (v16>>8)&255;
						data[di++] = lo;
						data[di++] = hi;
					}
					data[di++] = 200;
					data[di++] = 255;
					data[di++] = 150;
					data[di++] = 255;
					++num_quads;
					// we have a weird 20-byte per quad format that has to be
					// packed into a 2D texture, so we have to skip a couple of
					// wasted bytes in the end of each texture row (not to be
					// confused with a row of characters)
					if ((num_quads % QUADS_PER_ROW) === 0) {
						di += 4*(QUADS_UTEX_WIDTH - QUADS_PER_ROW*WORDS_PER_QUAD);
					}
				}
			}
		}
		assert(num_quads <= max_quads);

		gl.bindTexture(gl.TEXTURE_2D, this.quads_utex);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0, // level
			0, 0, // x/y offset
			QUADS_UTEX_WIDTH,
			utex_height, // XXX trim if possible; no need to upload more than needed
			gl.RGBA_INTEGER,
			gl.UNSIGNED_BYTE,
			data);

		gl.viewport(0,0,width,height);
		gl.clearColor(0,0,0.1,1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(this.program);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.quads_utex);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.atlas_tex);

		gl.uniform1i(this.u_quads, 0);
		gl.uniform1i(this.u_tex,   1);
		gl.uniform2f(this.u_fb_dim,  width, height);
		gl.uniform2f(this.u_tex_dim, atlas_image.width, atlas_image.height);

		gl.drawArrays(gl.TRIANGLES, 0, 6*num_quads);

		const maybe_fps = this.fps();
		if (maybe_fps !== null) console.info("FPS: " + maybe_fps.toFixed(1));

		if (this.unfuck.have_context) window.requestAnimationFrame(_=>this.render());
	}
}

export const create_web_terminal = (atlas_font) => new Promise((resolve, reject) => {
	if (!atlas_font) atlas_font = new AtlasFont();
	const t = new WebTerminal();
	t.set_atlas_font(atlas_font).then(_=>{
		resolve(t);
	}).catch(reject);
});
