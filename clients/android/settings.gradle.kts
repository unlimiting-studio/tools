pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    // uCrop 2.2.11은 JitPack에만 올라와 있다.
    repositories { google(); mavenCentral(); maven("https://jitpack.io") }
}
rootProject.name = "unlimiting-tools"
include(":tools")
