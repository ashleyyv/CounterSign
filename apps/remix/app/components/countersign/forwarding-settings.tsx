import { useEffect, useState } from 'react';

import { CheckIcon, PlusIcon, XIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';

type Target = {
  label: string;
  email: string;
};

export const ForwardingSettings = () => {
  const [targets, setTargets] = useState<Target[]>([]);
  const [saved, setSaved] = useState(false);

  const { data: preferences } = trpc.countersign.getSignerPreferences.useQuery();

  useEffect(() => {
    if (preferences?.targets) {
      setTargets(preferences.targets as Target[]);
    }
  }, [preferences]);

  const { mutate: upsert, isPending } = trpc.countersign.upsertSignerPreferences.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const updateTarget = (index: number, field: keyof Target, value: string) => {
    setTargets((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };

  const removeTarget = (index: number) => {
    setTargets((prev) => prev.filter((_, i) => i !== index));
  };

  const addTarget = () => {
    setTargets((prev) => [...prev, { label: '', email: '' }]);
  };

  const isValid = targets.every((t) => t.email.trim().length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold">Forwarding Targets</p>
        <p className="text-sm text-muted-foreground">
          After signing, you can forward a copy to up to 3 contacts in one tap.
        </p>
      </div>

      {targets.map((target, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={target.label}
            onChange={(e) => updateTarget(i, 'label', e.target.value)}
            placeholder="e.g. My Accountant"
            className="h-9 w-36 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="email"
            value={target.email}
            onChange={(e) => updateTarget(i, 'email', e.target.value)}
            placeholder="email@example.com"
            className="h-9 flex-1 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => removeTarget(i)}
            className="shrink-0"
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {targets.length < 3 && (
        <Button type="button" variant="outline" size="sm" onClick={addTarget} className="w-fit">
          <PlusIcon className="mr-2 h-4 w-4" />
          Add target
        </Button>
      )}

      <Button
        type="button"
        onClick={() => upsert({ targets })}
        loading={isPending}
        disabled={!isValid || isPending}
        className="w-fit"
      >
        {saved ? (
          <>
            <CheckIcon className="mr-2 h-4 w-4" />
            Saved
          </>
        ) : (
          'Save'
        )}
      </Button>
    </div>
  );
};
