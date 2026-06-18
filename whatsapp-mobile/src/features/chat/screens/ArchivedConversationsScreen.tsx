import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatAppStackParamList } from '../../../core/navigation/ChatAppStack';
import { useTheme } from '../../../theme/ThemeContext';
import type { AppColors } from '../../../theme/palettes';
import { GuestOutboundStatsBadges } from '../components/GuestOutboundStatsBadges';
import { useChatStore } from '../chat.store';
import { fetchArchivedConversations, unarchiveConversation } from '../services';
import type { Conversation } from '../types';
import { resolveConversationArea } from '../utils/locations';

type Props = NativeStackScreenProps<ChatAppStackParamList, 'ArchiveList'>;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
  }
  return (name.trim().slice(0, 2) || '?').toUpperCase();
}

function formatListDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function ArchivedConversationsScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createArchivedStyles(colors), [colors]);
  const { setActiveConversation } = useChatStore();
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultArea = route.params.defaultArea ?? 'athens';

  const loadArchived = useCallback(async (silent = false) => {
    let cancelled = false;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const conversations = await fetchArchivedConversations();
      if (!cancelled) setArchivedConversations(conversations);
    } catch (e) {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load archived conversations');
    } finally {
      if (!cancelled && !silent) setLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const conversations = await fetchArchivedConversations();
        if (!cancelled) setArchivedConversations(conversations);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load archived conversations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleUnarchive = useCallback(async (item: Conversation) => {
    Alert.alert(
      'Unarchive chat',
      `Move "${item.name}" back to your inbox?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unarchive',
          onPress: async () => {
            try {
              await unarchiveConversation(item.id);
              setArchivedConversations((prev) => prev.filter((c) => c.id !== item.id));
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not unarchive');
            }
          },
        },
      ],
    );
  }, []);

  const renderRow = ({ item }: { item: Conversation }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => {
        setActiveConversation(item.id);
        navigation.navigate('ConversationDetail', {
          conversationId: item.id,
          area: resolveConversationArea(item, defaultArea),
          conversationName: item.name,
          participantPhone: item.phone,
          isSelf: item.isSelf,
          templateOnly: item.templateOnly,
        });
      }}
      onLongPress={() => handleUnarchive(item)}
      delayLongPress={400}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{getInitials(item.name)}</Text>
      </View>
      <View style={styles.rowCenter}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.date}>{formatListDate(item.lastMessageAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          {item.lastMessage ? (
            <Text style={styles.lastMessage} numberOfLines={1}>
              {item.lastMessage}
            </Text>
          ) : (
            <Text style={styles.lastMessage} numberOfLines={1} />
          )}
          {(item.unreadCount ?? 0) > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
        </View>
        <GuestOutboundStatsBadges conversation={item} />
      </View>
      <TouchableOpacity
        style={styles.unarchiveBtn}
        onPress={() => handleUnarchive(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel="Unarchive"
      >
        <Ionicons name="archive-outline" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SafeAreaView edges={['top']} style={styles.headerSafe}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Archived</Text>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.content}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
        {error && !loading && <Text style={styles.error}>{error}</Text>}
        {!loading && !error && archivedConversations.length === 0 && (
          <Text style={styles.empty}>No archived chats</Text>
        )}
        {!loading && !error && archivedConversations.length > 0 && (
          <FlatList
            data={archivedConversations}
            keyExtractor={(item, index) => (item.id ? `${item.id}` : `arch-${index}`)}
            renderItem={renderRow}
          />
        )}
      </View>
    </View>
  );
}

function createArchivedStyles(colors: AppColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: '#202C33',
  },
  headerSafe: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  center: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  error: {
    fontSize: 14,
    color: colors.error,
    marginTop: 8,
  },
  empty: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  rowCenter: {
    flex: 1,
    minWidth: 0,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  date: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 8,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  lastMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    paddingHorizontal: 6,
  },
  unreadText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  unarchiveBtn: {
    paddingLeft: 10,
    paddingVertical: 4,
  },
  });
}

