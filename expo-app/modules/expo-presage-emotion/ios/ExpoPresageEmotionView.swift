import ExpoModulesCore
import UIKit

class ExpoPresageEmotionView: ExpoView {
  private let placeholderLabel: UILabel = {
    let label = UILabel()
    label.text = "Presage emotion recognition is available on Android. Use a development build on Android device."
    label.textAlignment = .center
    label.numberOfLines = 0
    label.textColor = .secondaryLabel
    label.font = .systemFont(ofSize: 14)
    return label
  }()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .systemGray6
    placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
    addSubview(placeholderLabel)
    NSLayoutConstraint.activate([
      placeholderLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
      placeholderLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
      placeholderLabel.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
      placeholderLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -24)
    ])
  }
}
