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

#include "s2c.h"
