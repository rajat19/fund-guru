export const getCategoryColor = (category: string) => {
  switch (category?.toLowerCase()) {
    case 'equity':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
    case 'hybrid':
      return 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
    case 'debt':
      return 'bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

export const getRiskColor = (risk: string) => {
  switch (risk?.toLowerCase()) {
    case 'low':
    case 'low to moderate':
      return 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
    case 'moderate':
    case 'moderately high':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800';
    case 'high':
    case 'very high':
      return 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
    default:
      return 'bg-muted text-muted-foreground';
  }
};
