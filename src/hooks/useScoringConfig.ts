import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ScoringWeights, defaultWeights } from '@/utils/scoringEngine';

const CONFIG_DOC_PATH = 'app_config/scoring_weights';

export const useScoringConfig = () => {
  const queryClient = useQueryClient();

  const { data: weights, isLoading } = useQuery<ScoringWeights>({
    queryKey: ['scoringWeights'],
    queryFn: async () => {
      const docRef = doc(db, CONFIG_DOC_PATH);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        // Merge with defaultWeights to ensure any missing new keys have a fallback
        return { ...defaultWeights, ...(docSnap.data() as Partial<ScoringWeights>) };
      }
      return defaultWeights;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  const mutation = useMutation({
    mutationFn: async (newWeights: ScoringWeights) => {
      const docRef = doc(db, CONFIG_DOC_PATH);
      await setDoc(docRef, newWeights);
      return newWeights;
    },
    onSuccess: (newWeights) => {
      queryClient.setQueryData(['scoringWeights'], newWeights);
    },
  });

  return {
    weights: weights || defaultWeights,
    isLoading,
    updateWeights: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
