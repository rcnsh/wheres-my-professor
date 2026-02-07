package expo.modules.presageemotion

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoPresageEmotionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoPresageEmotion")

    View(ExpoPresageEmotionView::class) {
      Events("onVitals")

      Prop("apiKey") { view: ExpoPresageEmotionView, apiKey: String? ->
        view.setApiKey(apiKey ?: "")
      }
    }
  }
}
