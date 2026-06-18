import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  FlatList,
  useWindowDimensions,
  Text,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatAppStackParamList } from '../../../core/navigation/ChatAppStack';

type Props = NativeStackScreenProps<ChatAppStackParamList, 'VideoPlayer'>;

export type MediaGalleryItem = ChatAppStackParamList['VideoPlayer']['items'][number];

function MediaSlide({
  item,
  width,
  height,
}: {
  item: MediaGalleryItem;
  width: number;
  height: number;
}) {
  const isVideo = item.type === 'video';
  const mediaUri = item.uri;
  const thumbnailUri = item.thumbnailUri;

  return (
    <View style={[slideStyles.slide, { width, height }]}>
      {isVideo ? (
        <Video
          source={{ uri: mediaUri }}
          style={{ width, height, backgroundColor: 'black' }}
          resizeMode={ResizeMode.COVER}
          useNativeControls
          shouldPlay
          isLooping={false}
          posterSource={thumbnailUri ? { uri: thumbnailUri } : undefined}
          usePoster={!!thumbnailUri}
        />
      ) : (
        <View style={[slideStyles.imageWrap, { width, height }]}>
          <Image source={{ uri: mediaUri }} style={{ width, height }} resizeMode="cover" />
        </View>
      )}
    </View>
  );
}

const slideStyles = StyleSheet.create({
  slide: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrap: {
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export function VideoPlayerScreen({ route, navigation }: Props) {
  const { items, initialIndex } = route.params;
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const flatListRef = useRef<FlatList<MediaGalleryItem>>(null);
  const { width, height } = useWindowDimensions();

  const renderItem = ({ item }: { item: MediaGalleryItem }) => (
    <MediaSlide item={item} width={width} height={height} />
  );

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-down" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCounter}>
            <Text style={styles.headerCounterText}>
              {currentIndex + 1} / {items.length}
            </Text>
          </View>
        </View>
      </SafeAreaView>
      <FlatList
        ref={flatListRef}
        data={items}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        initialScrollIndex={initialIndex}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        showsHorizontalScrollIndicator={false}
        renderItem={renderItem}
        onMomentumScrollEnd={(event) => {
          const newIndex = Math.round(event.nativeEvent.contentOffset.x / width);
          if (!Number.isNaN(newIndex)) {
            setCurrentIndex(newIndex);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  safe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: {
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  headerCounter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCounterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
