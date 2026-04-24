type NudgeIndicatorProps = {
  sentAt: Date | string;
};

export const NudgeIndicator = ({ sentAt }: NudgeIndicatorProps) => {
  const days = Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000);

  if (days < 7) {
    return null;
  }

  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      Pending {days} days
    </span>
  );
};
