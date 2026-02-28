#import <AppKit/AppKit.h>
#include <napi.h>

static Napi::Value Hide(const Napi::CallbackInfo& info) {
  [NSCursor hide];
  return info.Env().Undefined();
}

static Napi::Value Unhide(const Napi::CallbackInfo& info) {
  [NSCursor unhide];
  return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("hide", Napi::Function::New(env, Hide));
  exports.Set("unhide", Napi::Function::New(env, Unhide));
  return exports;
}

NODE_API_MODULE(cursor_native, Init)
