// wasm helpers and things

#include <stddef.h>
#include <stdint.h>
#include <wasm_simd128.h>

#define NO_RETURN     __attribute__((noreturn))
//#define PLEASE_EXPORT __attribute__((used))
#define PLEASE_EXPORT __attribute__((visibility("default"))) // FUN FACT: "default" is not the default visibility

#define ALIGN_LOG2(lg2,x)    (((x)+(1<<lg2)-1) & ~((1<<lg2)-1))
#define MAX_ALIGNMENT_LOG2  (4) // the biggest WASM alignment seems to be 128-bit/16-byte
#define ARRAY_LENGTH(xs) (sizeof(xs)/sizeof((xs)[0]))

static inline size_t our_strlen(const char* s)
{
	size_t len = 0;
	while (*(s++)) len++;
	return len;
}

static inline void* our_memcpy(void* dst, const void* src, size_t n)
{
	return __builtin_memcpy(dst, src, n);
}

static inline float our_floorf(float x) { return __builtin_floorf(x); }

// /////////////////////////////////
// MESSAGE
// a way to send a message back to JavaScript
// /////////////////////////////////

static int message_cursor;
static char message[1<<14];

PLEASE_EXPORT const char* get_message(void)
{
	return message;
}

static void reset_message(void)
{
	message[0] = 0;
	message_cursor = 0;
}

static void append_to_message(const char* string)
{
	const size_t n = our_strlen(string);
	const size_t remaining = (sizeof(message)-1) - message_cursor;
	const size_t can_write = n > remaining ? remaining : n;
	our_memcpy(message + message_cursor, string, can_write);
	message_cursor += can_write;
	message[message_cursor] = 0;
}

// /////////////////////////////////
// ASSERT
// /////////////////////////////////

NO_RETURN static void handle_failed_assertion(const char* failed_predicate, const char* location)
{
	reset_message();
	append_to_message("ASSERTION FAILED {{{ ");
	append_to_message(failed_predicate);
	append_to_message(" }}} at ");
	append_to_message(location);
	__builtin_trap(); // stops and throws WebAssembly.RuntimeError
}

#define STR2(s) #s
#define STR(s) STR2(s)
#define assert(p) if (!(p)) handle_failed_assertion(#p, __FILE__ ":" STR(__LINE__))

// /////////////////////////////////
// HEAP
// /////////////////////////////////

extern unsigned char __heap_base;
static size_t heap_bytes_allocated;
static size_t mem_size;
extern size_t js_grow_memory(size_t); // implemented in JS

PLEASE_EXPORT void heap_reset(void)
{
	heap_bytes_allocated = 0;
}

static void heap_grow_64k(size_t delta_64k_pages)
{
	mem_size = js_grow_memory(delta_64k_pages);
	assert(mem_size > 0);
}

static size_t get_mem_size(void)
{
	if (mem_size == 0) heap_grow_64k(0);
	assert(mem_size > 0);
	return mem_size;
}


PLEASE_EXPORT void* heap_alloc(int align_log2, size_t n)
{
	n = ALIGN_LOG2(align_log2,n);
	void* base = (void*)(ALIGN_LOG2(align_log2,(intptr_t)&__heap_base) + heap_bytes_allocated);
	intptr_t end = (intptr_t)base + n;
	intptr_t needed = end - get_mem_size();
	if (needed > 0) heap_grow_64k(ALIGN_LOG2(16,needed) >> 16);
	assert(end <= get_mem_size());
	heap_bytes_allocated += n;
	return base;
}

PLEASE_EXPORT float* heap_alloc_f32(size_t n) { return heap_alloc(2,n); }

#if 0
#define STBIRDEF PLEASE_EXPORT
#define STBIR_ASSERT(p) assert(p)
#define STBIR_MALLOC(size,user_data)    heap_alloc(MAX_ALIGNMENT_LOG2,size)
#define STBIR_FREE(ptr,user_data)       ((void)ptr)
#define STB_IMAGE_RESIZE_IMPLEMENTATION
#include "stb_image_resize2.h"
#endif

PLEASE_EXPORT void selftest_assertion_failure(void)
{
	assert((4==5) && "this expression is false");
}

// s2c: separable 2d convolution

static float* s2c_kernel;
static float* s2c_f32_scratch_space;
static int s2c_kernel_radius;

// returns a `float*` array with the length `2*kernel_radius-1`; you must fill
// this out with the kernel which center lies at index `kernel_radius-1`.
PLEASE_EXPORT float* s2c_setup(int kernel_radius, int max_input_width, int max_input_height)
{
	assert(kernel_radius >= 2);
	s2c_kernel_radius = kernel_radius;
	const size_t kernel_size = kernel_radius + kernel_radius - 1;

	s2c_kernel = heap_alloc_f32(kernel_size);

	// we need to apply the 1d convolution kernel in two steps; one step
	// for each axis.
	const size_t max_scratch_pixels = max_input_width * (max_input_height + kernel_size - 1);

	s2c_f32_scratch_space = heap_alloc_f32(max_scratch_pixels);

	return s2c_kernel;
}

static inline float u8_to_f32(uint8_t x)
{
	return (float)x * (1.0f/255.0f);
}

static inline uint8_t f32_to_u8(float x)
{
	int i = our_floorf(x*256.0f);
	if (i < 0) i = 0;
	if (i > 255) i = 255;
	return (uint8_t)i;
}

// performs separable 2d convolution; you should already have called
// s2c_setup(), and filled out the kernel. every pixel in the width×height box
// is written, but we only read the pixels in the content dx/dy/width/height
// box (relative to the image corner).
PLEASE_EXPORT void s2c_execute(uint8_t* image, int width, int height, int stride, int content_dx, int content_dy, int content_width, int content_height)
{
	float* const ssp0 = s2c_f32_scratch_space;
	const int R = s2c_kernel_radius;
	const int R1 = R-1;
	//const int K = R+R-1;
	float* k;
	uint8_t* p;
	int rclip;

	const int scratch_stride = content_height;

	// 1st pass
	// convolution is done in the X-direction. the result is written to
	// scratch with x/y flipped in the Y-direction, so that the Y-direction
	// convolution in the 2nd pass can read in the X-direction.
	for (int yc = 0; yc < content_height; yc++) {
		const int y = yc+content_dy;
		const int yo = y*stride;
		float* wp = ssp0+yc;

		// XXX check this for off-by-one (or 2) errors
		const int stop0 = R1;
		const int stop1 = width - R1;

		int x0 = 0;
		rclip = 0;
		for (; x0 < stop0; x0++) {
			float sum = 0.0f;
			p = image + yo;
			k = s2c_kernel + (R1-rclip);
			for (int dx=-rclip; dx<=R1; dx++) {
				sum += u8_to_f32(*(p++)) * (*(k++));
			}
			rclip++;
			(*wp) = sum;
			wp += scratch_stride;
		}
		assert(x0 == stop0);
		for (; x0 < stop1; x0++) {
			float sum = 0.0f;
			p = image + yo + x0 - R1;
			k = s2c_kernel;
			for (int dx=-R1; dx<=R1; dx++) {
				sum += u8_to_f32(*(p++)) * (*(k++));
			}
			(*wp) = sum;
			wp += scratch_stride;
		}
		assert(x0 == stop1);
		rclip = R1-1;
		for (; x0 < width; x0++) {
			float sum = 0.0f;
			p = image + yo + x0 - R1;
			k = s2c_kernel;
			for (int dx=-R1; dx<=rclip; dx++) {
				sum += u8_to_f32(*(p++)) * (*(k++));
			}
			rclip--;
			(*wp) = sum;
			wp += scratch_stride;
		}
	}

	// 2nd pass
	for (int x = 0; x < width; x++) {
		float* rp = ssp0 + x*scratch_stride;

		// XXX check this for off-by-one (or 2) errors
		const int stop0 = R1;
		const int stop1 = width - R1;

		int y0 = 0;
		p = image + x;
		for (; y0 < stop0; y0++) {
			float sum = 0.0f;
			(*p) = f32_to_u8(sum);
			p += stride;
		}
		for (; y0 < stop1; y0++) {
			float sum = 0.0f;
			(*p) = f32_to_u8(sum);
			p += stride;
		}
		for (; y0 < height; y0++) {
			float sum = 0.0f;
			(*p) = f32_to_u8(sum);
			p += stride;
		}
	}


}
