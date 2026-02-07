package expo.modules.presageemotion

import android.view.LayoutParams
import androidx.core.os.bundleOf
import com.presagetech.smartspectra.SmartSpectraSdk
import com.presagetech.smartspectra.SmartSpectraView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import android.content.Context

class ExpoPresageEmotionView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  private val onVitals by EventDispatcher()
  private var apiKey: String = ""

  private val smartSpectraView: SmartSpectraView = SmartSpectraView(context).also {
    it.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    addView(it)
  }

  init {
    SmartSpectraSdk.getInstance().apply {
      setMetricsBufferObserver { metricsBuffer ->
        val pulseRate = metricsBuffer.pulse.rateList.lastOrNull()?.value?.toDouble() ?: 0.0
        val breathingRate = metricsBuffer.breathing.rateList.lastOrNull()?.value?.toDouble() ?: 0.0
        if (pulseRate > 0 || breathingRate > 0) {
          onVitals(
            bundleOf(
              "pulseRate" to pulseRate,
              "breathingRate" to breathingRate
            )
          )
        }
      }
    }
  }

  fun setApiKey(key: String) {
    if (key == apiKey) return
    apiKey = key
    SmartSpectraSdk.getInstance().setApiKey(key)
  }
}
