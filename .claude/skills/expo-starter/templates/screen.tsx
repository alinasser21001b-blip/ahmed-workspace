import React, {useEffect} from 'react';
import {ScrollView} from 'react-native';
import {Text, View} from 'react-native-ui-lib';
import {observer} from 'mobx-react';
import {NavioScreen} from 'rn-navio';

import {services, useServices} from '@app/services';
// import {useStores} from '@app/stores';
import {useAppearance} from '@app/utils/hooks';

export type Params = {
  // id?: string;
};

export const ScreenName: NavioScreen = observer(() => {
  useAppearance(); // keeps the screen in sync with Dark Mode / language
  const {t, navio} = useServices();
  const navigation = navio.useN();
  const params = navio.useParams<Params>();
  // const {ui} = useStores();

  // State

  // Methods

  // Start
  useEffect(() => {
    configureUI();
  }, []);

  // UI Methods
  const configureUI = () => {
    navigation.setOptions({});
  };

  return (
    <View flex bg-bgColor>
      <ScrollView contentInsetAdjustmentBehavior="always">
        <View padding-s4>
          <Text textColor>{t.do('screenName.title')}</Text>
        </View>
      </ScrollView>
    </View>
  );
});

ScreenName.options = () => ({
  title: services.t.do('screenName.title'),
});
