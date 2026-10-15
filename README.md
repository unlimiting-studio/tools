# tools

unlimiting-studio 프로젝트에서 함께 사용하는 도구 API와 클라이언트 라이브러리입니다. API는 Cloudflare Worker 하나로 운영하며, 웹·iOS·Android 클라이언트를 같은 리포에서 배포합니다.

| 도구 | API | 설명 |
|---|---|---|
| 프로필 사진 크롭 | `POST /v1/profile-crop` | 사진에서 프로필용 정사각형 영역을 계산합니다 |

## 구조

```
worker/            Cloudflare Worker (API, API 키 관리, cf CLI로 배포)
clients/web/       웹 클라이언트 (TypeScript, npm 패키지 @unlimiting-studio/tools)
clients/ios/       iOS·macOS 클라이언트 (Swift Package, 루트 Package.swift에서 선언)
clients/android/   Android 클라이언트 (Kotlin, JitPack 배포)
```

## 프로필 사진 크롭

API는 크롭 영역만 계산합니다. 이미지를 줄여서 보내고 원본을 자르는 작업은 클라이언트 라이브러리가 기기에서 처리합니다.

### 동작 방식

1. 클라이언트가 EXIF 회전을 적용한 뒤 이미지를 긴 변 512px JPEG로 줄여 API에 보냅니다.
2. Worker가 OpenRouter의 Jev(`typesafe/jev-1.14`)를 한 번 호출해 다음 세 가지를 함께 받습니다.
   - 사람이나 동물의 얼굴이 있는지
   - 눈·코·입을 감싸는 박스
   - 사진에서 가장 중요한 피사체 박스
3. Worker가 정사각형 크롭 영역을 계산합니다.
   - **얼굴이 있을 때(확률 0.5 이상):** 눈·코·입 박스 중심에 맞추고 한 변을 박스 크기의 2.2배로 정합니다. 이미지 밖으로 넘치면 중심을 유지한 채 크기를 줄입니다.
   - **얼굴이 없을 때:** 피사체 박스 중심에 맞추고 한 변을 박스 크기의 1.15배로 정합니다. 이미지 밖으로 넘치면 크기를 유지한 채 이미지 안쪽으로 옮깁니다.
4. 클라이언트가 받은 비율 좌표로 원본 해상도 이미지를 자릅니다.

한 번 호출하는 비용은 약 $0.000035입니다. 1만 장을 처리하면 약 $0.35가 듭니다.

### API

```
POST /v1/profile-crop
Authorization: Bearer <API 키>
Content-Type: image/jpeg   (또는 image/png)
X-App-Id: <앱 ID>          (앱 ID를 제한한 키에서만 필요)

<이미지 바이트. 각 변 256~1568px, 2MB 이하>
```

응답의 `crop`은 보낸 이미지 크기에 대한 비율(0~1)입니다. 픽셀 기준으로 정사각형이므로, 같은 비율로 줄인 원본에 그대로 적용할 수 있습니다.

```json
{
  "mode": "face",
  "crop": { "left": 0.3382, "top": 0.152, "width": 0.4835, "height": 0.726 },
  "faceProbability": 0.96,
  "confidence": 0.69
}
```

- `mode`: `face`는 얼굴 기준, `subject`는 피사체 기준입니다.
- `faceProbability`: 얼굴이 있을 확률입니다.
- `confidence`: 사용한 박스의 신뢰도입니다. 0.4~0.9 사이에서 크게 변하므로 결과를 거르는 기준으로 사용하지 않는 것을 권장합니다.

오류는 `{ "error": "메시지" }` 형식으로 반환합니다. 주요 상태 코드는 400(이미지 크기·형식), 401(키), 403(Origin·앱 ID), 413(용량), 429(호출 한도), 502(Jev 호출 실패)입니다.

## 클라이언트 사용법

### 웹

```bash
npm i --allow-remote=all https://github.com/unlimiting-studio/tools/releases/download/v0.1.0/unlimiting-studio-tools-0.1.0.tgz
```

npm 12부터 URL로 패키지를 설치하려면 `--allow-remote=all`이 필요합니다. pnpm과 yarn은 옵션 없이 같은 URL로 설치할 수 있습니다.

```ts
import { createToolsClient } from "@unlimiting-studio/tools";

const tools = createToolsClient({ apiKey: "tk_..." });

// File, Blob 또는 ImageBitmap을 받습니다.
const { blob, mode, crop } = await tools.profileCrop(file, { size: 512 });

// 크롭 영역만 필요하면
const rect = await tools.profileCropRect(file);
```

`size`를 생략하면 원본 해상도로 자릅니다. 출력 형식은 `type`(기본 `image/jpeg`)과 `quality`(기본 0.9)로 지정합니다.

### iOS

Xcode에서 **File > Add Package Dependencies**를 열고 `https://github.com/unlimiting-studio/tools`를 추가합니다. iOS 15 이상과 macOS 12 이상을 지원합니다.

```swift
import UnlimitingTools

let tools = ToolsClient(apiKey: "tk_...")   // X-App-Id로 번들 ID를 보냅니다

let (image, rect) = try await tools.profileCrop(uiImage, size: 512)   // UIImage
let result = try await tools.profileCrop(data: jpegData, size: 512)   // JPEG·HEIC 등 Data → CGImage
```

### Android

`settings.gradle.kts`에 JitPack 저장소를 추가하고 의존성을 선언합니다. minSdk 24 이상을 지원합니다.

```kotlin
dependencyResolutionManagement {
    repositories { google(); mavenCentral(); maven("https://jitpack.io") }
}

dependencies {
    implementation("com.github.unlimiting-studio:tools:v0.1.0")
}
```

```kotlin
val tools = ToolsClient(context, apiKey = "tk_...")   // X-App-Id로 패키지명을 보냅니다

val result = tools.profileCrop(bitmap, size = 512)   // suspend 함수
val fromBytes = tools.profileCrop(jpegBytes, size = 512)   // EXIF 회전을 적용합니다
```

## API 키 관리

새 프로젝트마다 키를 따로 발급합니다. 키 원문은 발급할 때 한 번만 보여 주며, Worker의 KV에는 SHA-256 해시만 저장합니다. 키가 유출되면 해당 키만 폐기하고 새로 발급합니다.

| 키 종류 | 발급 옵션 | 허용 조건 |
|---|---|---|
| 웹 | `--origin https://example.com` | 요청의 `Origin` 헤더가 목록에 있어야 합니다 |
| 앱 | `--app com.example.app` | 요청의 `X-App-Id` 헤더가 목록에 있어야 합니다 |
| 서버 | 옵션 없음 | 제한하지 않습니다 |

Origin과 앱 ID 확인은 다른 사이트나 앱이 키를 그대로 가져가 사용하는 경우를 막습니다. 앱에 포함된 키는 추출할 수 있으므로 비밀값으로 취급하지 않으며, 모든 키에 분당 60회 호출 한도를 적용합니다.

```bash
cd worker
export TOOLS_ADMIN_TOKEN=...   # 관리자 토큰

node scripts/keys.mjs create my-app --origin https://my-app.com --app com.example.myapp
node scripts/keys.mjs list
node scripts/keys.mjs delete k_xxxxxxxxxxxx
```

## 개발과 배포

### Worker

Cloudflare 작업에는 `cf` CLI를 사용합니다. 설정은 `worker/cloudflare.config.ts`에 있습니다.

```bash
cd worker
npm i
cp .dev.vars.example .dev.vars   # OPENROUTER_API_KEY, ADMIN_TOKEN 입력
npm run dev                      # cf dev
npm test
npm run typecheck                # cf workers types && tsc
```

배포 주소는 https://tools.yechanny.workers.dev 입니다. KV 네임스페이스는 첫 배포 때 자동으로 만들어집니다. 시크릿은 파일로 전달하고, 배포 후 파일을 삭제합니다.

```bash
cf deploy --secrets-file <OPENROUTER_API_KEY와 ADMIN_TOKEN을 담은 .env 파일>
cf workers secrets list --worker tools   # 시크릿 등록 확인
```

시크릿을 바꾸지 않는 배포는 `npm run deploy`(`cf deploy`)로 실행합니다.

### 새 도구 추가

1. `worker/src/tools/<도구>.ts`에 `(request, env) => Promise<결과>` 형태의 함수를 작성합니다. 잘못된 입력은 `HttpError`를 던져 처리합니다.
2. `worker/src/index.ts`의 `TOOLS`에 등록합니다. 등록하면 `POST /v1/<도구>`로 호출할 수 있으며 API 키 인증과 호출 한도가 자동으로 적용됩니다.
3. 각 클라이언트에 같은 이름의 메서드를 추가합니다.

### 클라이언트 테스트

```bash
# 웹
cd clients/web && npm i && npm run build

# iOS (실제 API 호출 테스트는 환경변수가 있을 때만 실행)
TOOLS_API_KEY=tk_... TOOLS_TEST_IMAGE=photo.jpg swift test

# Android
cd clients/android
./gradlew :tools:testDebugUnitTest
./gradlew :tools:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.apiKey=tk_... \
  -Pandroid.testInstrumentationRunnerArguments.image=/data/local/tmp/test.jpg
```

### 릴리스

- **웹:** `clients/web`에서 `npm pack`으로 만든 tgz를 `v<버전>` 태그의 GitHub Release에 첨부합니다.
- **iOS:** 같은 `v<버전>` 태그로 SwiftPM에서 해당 버전을 사용할 수 있습니다.
- **Android:** JitPack이 같은 태그로 빌드합니다.
