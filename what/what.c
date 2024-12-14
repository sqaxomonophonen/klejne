// wasm helpers and things

#define WITH_DEBUG_PRINTF

#include <stddef.h>
#include <stdint.h>
#include <wasm_simd128.h>

#define NO_RETURN     __attribute__((noreturn))
//#define PLEASE_EXPORT __attribute__((used))
#define PLEASE_EXPORT __attribute__((visibility("default"))) // FUN FACT: "default" is not the default visibility

#define ALIGN_LOG2(lg2,x)    (((x)+(1<<lg2)-1) & ~((1<<lg2)-1))
#define MAX_ALIGNMENT_LOG2  (4) // the biggest WASM alignment seems to be 128-bit/16-byte
#define ARRAY_LENGTH(xs) (sizeof(xs)/sizeof((xs)[0]))

static inline void* memcpy(void* dst, const void* src, size_t n) { return __builtin_memcpy(dst, src, n); }
static inline void* memset(void* dst, int c, size_t n)           { return __builtin_memset(dst, c, n); }
static inline float floorf(float x)                              { return __builtin_floorf(x); }

static inline size_t strlen(const char* s)
{
	// there's no __builtin_strlen() (__builtin_strlen is defined though
	// but causes a linker error because "strlen" is not found)
	size_t len = 0;
	while (*(s++)) len++;
	return len;
}

// /////////////////////////////////
// MESSAGE
// a way to send a message back to JavaScript
// /////////////////////////////////

static int message_cursor;

#ifdef WITH_DEBUG_PRINTF
#define MESSAGE_CAP (1<<18)
#else
#define MESSAGE_CAP (1<<14)
#endif
static char message[MESSAGE_CAP];

PLEASE_EXPORT const char* get_message(void)
{
	return message;
}

PLEASE_EXPORT void clear_message(void)
{
	message[0] = 0;
	message_cursor = 0;
}

static void append_to_message(const char* string)
{
	const size_t n = strlen(string);
	const size_t remaining = (sizeof(message)-1) - message_cursor;
	const size_t can_write = n > remaining ? remaining : n;
	memcpy(message + message_cursor, string, can_write);
	message_cursor += can_write;
	message[message_cursor] = 0;
}

#ifdef WITH_DEBUG_PRINTF
#define STB_SPRINTF_IMPLEMENTATION
#include <stdarg.h>
#include "stb_sprintf.h"
static void DEBUG_PRINTF(const char* fmt, ...)
{
	va_list ap;
	va_start(ap, fmt);
	message_cursor += stbsp_vsnprintf(message+message_cursor, sizeof(message)-message_cursor, fmt, ap);
	va_end(ap);

}
#else
#define DEBUG_PRINTF(...)
#endif

// /////////////////////////////////
// ASSERT
// /////////////////////////////////

NO_RETURN static void handle_failed_assertion(const char* failed_predicate, const char* location)
{
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


// allocate n<<align_log2 bytes aligned to 1<<align_log2
PLEASE_EXPORT void* heap_alloc(int align_log2, size_t n)
{
	const size_t n_bytes = n << align_log2;
	void* base = (void*)(ALIGN_LOG2(align_log2,(intptr_t)&__heap_base) + heap_bytes_allocated);
	intptr_t end = (intptr_t)base + n_bytes;
	intptr_t needed = end - get_mem_size();
	if (needed > 0) heap_grow_64k(ALIGN_LOG2(16,needed) >> 16);
	assert(end <= get_mem_size());
	heap_bytes_allocated += n_bytes;
	return base;
}

PLEASE_EXPORT float* heap_alloc_u8(size_t n)  { return heap_alloc(0,n); }
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
	int i = floorf(x*256.0f);
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
	float* const ssp0_end = ssp0+(width*height);
	const int R = s2c_kernel_radius;
	const int R2 = 2*R;
	const int R21 = R2+1;
	const float* K = s2c_kernel;
	const float* Kend = K+R21;

	// first pass; X-axis convolution; result is written to scratch with
	// x/y axes swapped (meaning the 2nd pass Y-convolution can read from
	// scratch in X-direction)
	const int y0 = R;
	const int y1 = height-R;
	const int dy = y1-y0;
	const int scratch_stride = dy;
	int pyoff = stride*y0;
	for (int yi = 0; yi < dy; ++yi, pyoff+=stride) {
		float* sp = ssp0 + yi;
		const uint8_t* pb = image + pyoff;
		const uint8_t* pbend = pb + stride;
		for (int x = 0; x < width; ++x, sp+=scratch_stride) {
			const int k0 = ((x<R) ? (R-x) : 0);
			const float* k = K + k0;
			const int km = R21-k0;
			const int p0 = ((x<R) ? 0 : (x-R));
			const uint8_t* p = pb + p0;
			const int nm = width-p0;
			const int n = km<nm ? km : nm;
			float sum = 0.0f;
			for (int i=0; i<n; ++i, ++p, ++k) {
				assert(pb <= p && p < pbend);
				assert(K <= k && k < Kend);
				sum += u8_to_f32(*p) * (*k);
			}
			assert(ssp0 <= sp && sp < ssp0_end);
			(*sp) = sum;
		}
	}

	memset(image, 42, width*height); // tracer

	// second pass; Y-axis convolution
	for (int x = 0; x < width; ++x) {
		const float* const spb = ssp0 + x*scratch_stride;
		const float* const spb_end = spb+scratch_stride;
		assert(ssp0 <= spb && spb_end <= ssp0_end);
		uint8_t* p = image + x;
		for (int y = 0; y < height; ++y, p+=stride) {
			const int k0 = ((y<R2) ? (R2-y) : 0);
			const float* k = K + k0;
			const int km = R21-k0;
			const int s0 = ((y<R2) ? 0 : (y-R2));
			const float* const spb2 = spb + s0;
			const int nm = height-s0;
			assert(nm > 0);
			const int n = km<nm ? km : nm;
			float sum = 0.0f;
			DEBUG_PRINTF("y=%d n=%d k[%d] spb[%d]\n", y, n, k0, s0);
			const float* sp = spb2;
			for (int i=0; i<n; ++i, ++sp, ++k) {
				assert(spb <= sp && sp < spb_end);
				assert(K <= k && k < Kend);
				sum += *(sp) * (*k);
			}
			(*p) = f32_to_u8(sum);
		}
	}
}
