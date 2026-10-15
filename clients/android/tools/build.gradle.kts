plugins {
    id("com.android.library")
    `maven-publish`
}

group = "com.github.unlimiting-studio"
version = "0.2.0"

android {
    namespace = "studio.unlimiting.tools"
    compileSdk = 36
    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    publishing { singleVariant("release") { withSourcesJar() } }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("androidx.exifinterface:exifinterface:1.4.2")
    // 크롭 화면: 제스처·딤 레이어는 uCrop을 쓴다. JitPack 배포본 POM에 의존성이 없어 필요한 것을 직접 적는다.
    implementation("com.github.yalantis:ucrop:2.2.11")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity:1.10.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}

publishing {
    publications {
        register<MavenPublication>("release") {
            artifactId = "tools"
            afterEvaluate { from(components["release"]) }
        }
    }
}
