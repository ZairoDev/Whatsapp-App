import { create } from 'zustand';

export type InAppBannerPayload = {
  conversationId: string;
  businessPhoneId?: string;
  title?: string;
  body?: string;
  timestamp?: number;
};

type InAppBannerState = {
  visible: boolean;
  payload: InAppBannerPayload | null;
  show: (payload: InAppBannerPayload) => void;
  hide: () => void;
};

export const useInAppBannerStore = create<InAppBannerState>((set) => ({
  visible: false,
  payload: null,
  show: (payload) => set({ visible: true, payload }),
  hide: () => set({ visible: false, payload: null }),
}));

