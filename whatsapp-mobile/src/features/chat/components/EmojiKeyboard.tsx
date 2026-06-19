import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import type { AppColors } from '../../../theme/palettes';

type EmojiCategory = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  emojis: string[];
};

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    icon: 'happy-outline',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍',
      '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫',
      '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤',
      '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸',
      '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨',
      '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠',
    ],
  },
  {
    id: 'gestures',
    icon: 'hand-left-outline',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
      '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝',
      '🙏', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀',
      '👁️', '👅', '👄', '💋', '🩸',
    ],
  },
  {
    id: 'hearts',
    icon: 'heart-outline',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗',
      '💖', '💘', '💝', '💟', '♥️', '💌', '💐', '🌹', '🥀', '🌺', '🌸', '💮', '🏵️', '🌻', '🌼',
    ],
  },
  {
    id: 'animals',
    icon: 'paw-outline',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸',
      '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗',
      '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️',
    ],
  },
  {
    id: 'food',
    icon: 'fast-food-outline',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍',
      '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅',
      '🍞', '🥐', '🥖', '🥨', '🧀', '🥚', '🍳', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔',
      '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🍝', '🍜', '🍲', '🍛', '🍣',
    ],
  },
  {
    id: 'travel',
    icon: 'airplane-outline',
    emojis: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️',
      '🛵', '🚲', '🛴', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🚀', '🛸', '🚁', '🛶',
      '⛵', '🚤', '🛥️', '🛳️', '⚓', '🏠', '🏡', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪',
      '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🌋', '⛰️',
    ],
  },
  {
    id: 'objects',
    icon: 'bulb-outline',
    emojis: [
      '⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '📷', '📸', '📹', '🎥', '📞', '☎️', '📺', '📻',
      '🎙️', '🎚️', '🎛️', '⏰', '⏱️', '⏲️', '⌛', '⏳', '🔋', '🔌', '💡', '🔦', '🕯️', '🧯', '🛢️',
      '💸', '💵', '💴', '💶', '💷', '💰', '💳', '💎', '⚖️', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩',
      '⚙️', '🧰', '🔫', '💣', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '⚱️', '🏺', '🔮', '📿', '🧿',
    ],
  },
  {
    id: 'symbols',
    icon: 'heart-circle-outline',
    emojis: [
      '✅', '❌', '❓', '❗', '‼️', '⁉️', '💯', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪',
      '🟤', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '🔘', '🔳', '🔲', '▪️', '▫️', '◾', '◽',
      '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊',
      '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐',
    ],
  },
];

interface EmojiKeyboardProps {
  height: number;
  safeAreaBottom: number;
  onEmojiSelected: (emoji: string) => void;
  onKeyboardPress: () => void;
}

export function EmojiKeyboard({
  height,
  safeAreaBottom,
  onEmojiSelected,
  onKeyboardPress,
}: EmojiKeyboardProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const [activeCategoryId, setActiveCategoryId] = useState(EMOJI_CATEGORIES[0].id);

  const activeCategory =
    EMOJI_CATEGORIES.find((category) => category.id === activeCategoryId) ?? EMOJI_CATEGORIES[0];

  return (
    <View style={[styles.panel, { height }]}>
      <FlatList
        data={activeCategory.emojis}
        key={`${activeCategoryId}-${activeCategory.emojis.length}`}
        keyExtractor={(item, index) => `${activeCategoryId}-${item}-${index}`}
        numColumns={8}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.emojiGrid}
        style={styles.emojiList}
        renderItem={({ item }) => (
          <Pressable
            style={styles.emojiBtn}
            onPress={() => onEmojiSelected(item)}
            accessibilityRole="button"
            accessibilityLabel={`Insert ${item}`}
          >
            <Text style={styles.emojiText}>{item}</Text>
          </Pressable>
        )}
      />

      <View style={[styles.categoryBar, { paddingBottom: safeAreaBottom }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
          keyboardShouldPersistTaps="always"
        >
          {EMOJI_CATEGORIES.map((category) => {
            const active = category.id === activeCategoryId;
            return (
              <Pressable
                key={category.id}
                style={[styles.categoryBtn, active && styles.categoryBtnActive]}
                onPress={() => setActiveCategoryId(category.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Ionicons
                  name={category.icon}
                  size={20}
                  color={active ? colors.primary : colors.textMuted}
                />
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          style={styles.keyboardBtn}
          onPress={onKeyboardPress}
          accessibilityRole="button"
          accessibilityLabel="Show keyboard"
        >
          <Ionicons name="keypad-outline" size={22} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: AppColors, isDark: boolean) {
  return StyleSheet.create({
    panel: {
      overflow: 'hidden',
      backgroundColor: isDark ? '#0B141A' : '#E9EDEF',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    },
    emojiList: {
      flex: 1,
    },
    emojiGrid: {
      paddingHorizontal: 4,
      paddingTop: 8,
      paddingBottom: 4,
    },
    emojiBtn: {
      flex: 1,
      maxWidth: '12.5%',
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 40,
    },
    emojiText: {
      fontSize: Platform.OS === 'ios' ? 26 : 24,
      lineHeight: Platform.OS === 'ios' ? 30 : 28,
    },
    categoryBar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      backgroundColor: isDark ? '#111B21' : '#F0F2F5',
      paddingRight: 4,
    },
    categoryScroll: {
      flexGrow: 1,
      paddingHorizontal: 4,
      alignItems: 'center',
    },
    categoryBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    },
    categoryBtnActive: {
      backgroundColor: isDark ? 'rgba(37,211,102,0.12)' : 'rgba(37,211,102,0.15)',
    },
    keyboardBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
