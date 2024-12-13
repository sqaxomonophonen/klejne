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
static int s2c_max_width;
static int s2c_max_height;

// returns a `float*` array with the length `2*kernel_radius+1`; you must fill
// this out with the kernel which center lies at index `kernel_radius`.
PLEASE_EXPORT float* s2c_setup(int kernel_radius, int max_width, int max_height)
{
	assert(kernel_radius >= 1);
	s2c_kernel_radius = kernel_radius;
	const size_t kernel_size = kernel_radius + kernel_radius + 1;
	s2c_kernel = heap_alloc_f32(kernel_size);
	s2c_max_width = max_width;
	s2c_max_height = max_height;
	const size_t max_scratch_pixels = max_width * max_height;
	//const size_t max_scratch_pixels = max_width * (max_height - 2*kernel_radius);
	// XXX ^^^ use this instead? should be safe due to the "empty border"
	// assumption
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

// perform in-place separable 2d convolution. NOTE: the image input is assumed
// to be blank within kernel radius of the border; presently a safe assumption
// because it's used for gaussian blurs and we have no use for cropped blurs.
PLEASE_EXPORT void s2c_execute(uint8_t* image, int width, int height, int stride)
{
	assert((width <= s2c_max_width) && (height <= s2c_max_height));
	float* const ssp0 = s2c_f32_scratch_space;
	const int R = s2c_kernel_radius;

	// first pass; X-axis convolution; result is written to scratch with
	// x/y axes swapped (meaning the 2nd pass Y-convolution can read from
	// scratch in X-direction)
	const int y0 = R;
	const int y1 = height-R;
	const int scratch_stride = y1-y0;
	for (int y = y0; y < y1; y++) {
		const int yoff = stride*y;
		float* sp = ssp0 + y;
		for (int x = 0; x < width; x++) {
			const int s0 = x<R          ? (R-x) : 0;
			const int s1 = x>=(width-R) ? (x-width-R) : 0;
			const uint8_t* p = image + yoff + (x<=R ? 0 : x-R);
			const float* k = s2c_kernel + s0;
			float sum = 0.0f;
			for (int dx=-R+s0; dx<=(R-s1); dx++) {
				sum += u8_to_f32(*(p++)) * (*(k++));
			}
			(*sp) = sum;
			sp += scratch_stride;
		}
	}

	// second pass; Y-axis convolution
	for (int x = 0; x < width; x++) {
		uint8_t* p = image + x;
		const int xoff = x*scratch_stride;
		for (int y = 0; y < height; y++) {
			const int s0 = y<R           ? (R-y) : 0;
			const int s1 = y>=(height-R) ? (y-height-R) : 0;
			const float* sp = ssp0 + xoff + y + (y<=R ? 0 : y-R);
			const float* k = s2c_kernel + s0;
			float sum = 0.0f;
			for (int dy=-R+s0; dy<=(R-s1); dy++) {
				sum += (*(sp++)) * (*(k++));
			}
			(*p) = f32_to_u8(sum);
			p += stride;
		}
	}
}
