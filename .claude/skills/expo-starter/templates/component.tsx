import React from 'react';
import {Text, View} from 'react-native-ui-lib';
import {observer} from 'mobx-react';

import {useAppearance} from '@app/utils/hooks';

type Props = {
  title?: string;
};

// drop `observer()` if the component reads no store state
export const SampleComponent: React.FC<Props> = observer(({title}) => {
  useAppearance(); // only needed if the component should react to theme/language changes

  return (
    <View padding-s3 bg-bg2Color>
      <Text textColor>{title}</Text>
    </View>
  );
});
