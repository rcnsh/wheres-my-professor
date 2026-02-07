require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'ExpoPresageEmotion'
  s.version      = package['version']
  s.summary      = 'Presage SmartSpectra + emotion inference'
  s.description  = s.summary
  s.homepage     = 'https://github.com/expo/expo'
  s.license      = 'MIT'
  s.author       = 'Expo'
  s.source       = { :git => 'https://github.com/expo/expo.git' }
  s.platforms    = { :ios => '15.1' }
  s.source_files = '**/*.swift'
  s.dependency   'ExpoModulesCore'
end
