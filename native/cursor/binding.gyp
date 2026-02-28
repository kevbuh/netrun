{
  "targets": [{
    "target_name": "cursor_native",
    "sources": ["cursor.mm"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "xcode_settings": {
      "CLANG_CXX_LIBRARY": "libc++",
      "MACOSX_DEPLOYMENT_TARGET": "10.15",
      "OTHER_LDFLAGS": ["-framework AppKit"]
    }
  }]
}
