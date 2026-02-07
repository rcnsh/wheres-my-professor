import ExpoModulesCore

public class ExpoPresageEmotionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoPresageEmotion")

    View(ExpoPresageEmotionView.self) {
      Events("onVitals")
      Prop("apiKey") { (_: ExpoPresageEmotionView, _: String?) in
        // No-op on iOS; Presage SmartSpectra is Android-only in this module
      }
    }
  }
}
