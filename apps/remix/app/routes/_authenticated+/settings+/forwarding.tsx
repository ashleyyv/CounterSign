import { msg } from '@lingui/core/macro';

import { SettingsHeader } from '~/components/general/settings-header';
import { appMetaTags } from '~/utils/meta';

import { ForwardingSettings } from '../../../components/countersign/forwarding-settings';

export function meta() {
  return appMetaTags(msg`Forwarding`);
}

export default function SettingsForwarding() {
  return (
    <div>
      <SettingsHeader
        title="Forwarding"
        subtitle="Configure contacts to receive a copy of documents you sign."
      />

      <div className="max-w-xl">
        <ForwardingSettings />
      </div>
    </div>
  );
}
