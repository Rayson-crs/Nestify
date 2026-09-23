# Third-party media tool notices

Nestify bundles platform-specific media executables as part of the desktop application resources.

## FFmpeg

- Source package: `ffmpeg-static@5.3.0`
- Windows binary version: FFmpeg 6.1.1
- License: GPL-3.0-or-later
- Packaged executable: `resources/ffmpeg/ffmpeg.exe`
- Packaged license text: `resources/ffmpeg/ffmpeg.LICENSE.txt`

## FFprobe

- Source package: `@ffprobe-installer/ffprobe@2.1.2`
- Platform binaries are selected by the installer package and its platform packages.
- License: GPL-3.0
- Packaged executable: `resources/ffmpeg/ffprobe.exe`
- Packaged license text: `resources/ffmpeg/ffprobe.LICENSE.txt`

The executables are copied into the application resources by `apps/desktop/scripts/prepare-ffmpeg.mjs`. They are not committed to the repository. The lookup order at runtime is the `NESTIFY_FFMPEG_PATH` / `NESTIFY_FFPROBE_PATH` environment variables, bundled application resources, then the system `PATH`.
