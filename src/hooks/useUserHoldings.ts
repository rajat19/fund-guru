import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import {
  emptySnapshot,
  isSnapshotEmpty,
  sanitiseSnapshot,
  type HoldingsSnapshot,
  type MfHolding,
  type SipHolding,
} from '@/types/userHoldings';

/**
 * The working copy of the user's portfolio.
 *
 * **Signed out, nothing is stored anywhere.** Not localStorage, not
 * sessionStorage, not IndexedDB — the snapshot lives in React state and a refresh
 * is meant to clear it. That is a deliberate choice rather than an omission: this
 * is somebody's whole financial position, and quietly leaving it in browser
 * storage on a machine that might be shared is a worse default than making them
 * upload the file again. The UI says so plainly instead of hiding it.
 *
 * **Signed in, it is saved only when they ask.** Firestore holds one document per
 * user at `users/{uid}/holdings/snapshot`, owner-only by the existing rules. It is
 * written on an explicit Save, never on import and never on edit, so uploading a
 * file to look at something is not the same as filing it away.
 */

const SNAPSHOT_COLLECTION = 'holdings';
const SNAPSHOT_DOC = 'snapshot';

const snapshotRef = (uid: string) => doc(db, 'users', uid, SNAPSHOT_COLLECTION, SNAPSHOT_DOC);

export interface UseUserHoldings {
  snapshot: HoldingsSnapshot;
  /** Replace the holdings list. A fresh import replaces rather than appends. */
  setMfHoldings: (rows: MfHolding[]) => void;
  setSipHoldings: (rows: SipHolding[]) => void;
  removeMfHolding: (id: string) => void;
  removeSipHolding: (id: string) => void;
  clearAll: () => void;

  isEmpty: boolean;
  /** True when the working copy differs from what is saved. */
  isDirty: boolean;
  /** Whether saving is possible at all — that is, whether anyone is signed in. */
  canSave: boolean;

  /** A previously saved snapshot exists for this user. */
  hasSaved: boolean;
  isLoadingSaved: boolean;
  savedAt: string | null;

  save: () => Promise<void>;
  isSaving: boolean;
  loadSaved: () => void;
  deleteSaved: () => Promise<void>;
  isDeleting: boolean;
  error: string | null;
}

export const useUserHoldings = (): UseUserHoldings => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const uid = user?.uid ?? null;

  const [snapshot, setSnapshot] = useState<HoldingsSnapshot>(emptySnapshot);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Whether the user has touched the working copy in this session. Guards the
   * auto-adopt below: pulling a saved snapshot over a file someone just uploaded
   * would destroy work they can see on screen.
   */
  const touched = useRef(false);

  const saved = useQuery({
    queryKey: ['user-holdings', uid],
    enabled: uid != null,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<HoldingsSnapshot | null> => {
      if (!uid) return null;
      const snap = await getDoc(snapshotRef(uid));
      return snap.exists() ? sanitiseSnapshot(snap.data()) : null;
    },
  });

  // Adopt the saved copy on sign-in, but only into an untouched working set.
  useEffect(() => {
    const stored = saved.data;
    if (!stored || touched.current || !isSnapshotEmpty(snapshot)) return;
    if (isSnapshotEmpty(stored)) return;

    // Marked as touched so this cannot fire a second time — otherwise clearing
    // the list would silently pull the saved copy straight back in.
    touched.current = true;
    setSnapshot(stored);
    setIsDirty(false);
  }, [saved.data, snapshot]);

  /*
   * Signing out drops the working copy.
   *
   * It was loaded from that account, so leaving it on screen for whoever signs in
   * next — or for nobody — would be both confusing and a small privacy leak.
   */
  useEffect(() => {
    if (uid != null) return;
    if (!touched.current) return;
    // Only clear what came from an account; an anonymous upload is untouched by
    // sign-out because it was never associated with one.
    if (snapshot.savedAt == null) return;

    setSnapshot(emptySnapshot());
    setIsDirty(false);
    touched.current = false;
  }, [uid, snapshot.savedAt]);

  const mutate = useCallback((next: (current: HoldingsSnapshot) => HoldingsSnapshot) => {
    touched.current = true;
    setIsDirty(true);
    setError(null);
    setSnapshot((current) => next(current));
  }, []);

  const setMfHoldings = useCallback(
    (rows: MfHolding[]) => mutate((current) => ({ ...current, mf: rows })),
    [mutate],
  );

  const setSipHoldings = useCallback(
    (rows: SipHolding[]) => mutate((current) => ({ ...current, sips: rows })),
    [mutate],
  );

  const removeMfHolding = useCallback(
    (id: string) =>
      mutate((current) => ({ ...current, mf: current.mf.filter((row) => row.id !== id) })),
    [mutate],
  );

  const removeSipHolding = useCallback(
    (id: string) =>
      mutate((current) => ({ ...current, sips: current.sips.filter((row) => row.id !== id) })),
    [mutate],
  );

  const clearAll = useCallback(() => {
    // Stays "touched" on purpose: clearing is a deliberate act, and letting the
    // auto-adopt treat the result as a fresh session would undo it instantly.
    touched.current = true;
    setIsDirty(false);
    setError(null);
    setSnapshot(emptySnapshot());
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (): Promise<HoldingsSnapshot> => {
      if (!uid) throw new Error('Sign in to save your holdings.');

      const savedAt = new Date().toISOString();
      const payload: HoldingsSnapshot = { ...snapshot, savedAt };

      await setDoc(snapshotRef(uid), {
        ...payload,
        // Client clocks are wrong often enough to be worth a server-side truth
        // alongside the ISO string the UI reads back.
        updatedAt: serverTimestamp(),
      });

      return payload;
    },
    onSuccess: (payload) => {
      setSnapshot(payload);
      setIsDirty(false);
      setError(null);
      queryClient.setQueryData(['user-holdings', uid], payload);
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not save. Try again.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!uid) throw new Error('Not signed in.');
      await deleteDoc(snapshotRef(uid));
    },
    onSuccess: () => {
      queryClient.setQueryData(['user-holdings', uid], null);
      clearAll();
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not delete the saved copy.');
    },
  });

  const loadSaved = useCallback(() => {
    const stored = saved.data;
    if (!stored) return;
    touched.current = true;
    setSnapshot(stored);
    setIsDirty(false);
  }, [saved.data]);

  /*
   * Warn before leaving with unsaved changes, but only when saving is actually
   * possible. For a signed-out visitor the loss is by design and already stated
   * on screen, so a browser dialog would be nagging about the documented
   * behaviour.
   */
  const shouldWarn = uid != null && isDirty && !isSnapshotEmpty(snapshot);
  useEffect(() => {
    if (!shouldWarn) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers show their own generic wording; returning a value is what marks
      // the event as needing confirmation.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [shouldWarn]);

  return {
    snapshot,
    setMfHoldings,
    setSipHoldings,
    removeMfHolding,
    removeSipHolding,
    clearAll,

    isEmpty: isSnapshotEmpty(snapshot),
    isDirty,
    canSave: uid != null,

    hasSaved: saved.data != null && !isSnapshotEmpty(saved.data),
    isLoadingSaved: saved.isLoading,
    savedAt: saved.data?.savedAt ?? null,

    save: async () => {
      await saveMutation.mutateAsync();
    },
    isSaving: saveMutation.isPending,
    loadSaved,
    deleteSaved: async () => {
      await deleteMutation.mutateAsync();
    },
    isDeleting: deleteMutation.isPending,
    error,
  };
};
