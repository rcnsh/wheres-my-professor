import * as React from 'react';
import { ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import type { PresageEmotionViewProps, VitalsEvent } from './ExpoPresageEmotion.types';

type Props = PresageEmotionViewProps & ViewProps;

const NativeView = requireNativeViewManager<Props>('ExpoPresageEmotion');

export default function ExpoPresageEmotionView(props: Props) {
  return <NativeView {...props} />;
}

export type { VitalsEvent, PresageEmotionViewProps };
