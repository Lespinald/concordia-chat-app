import ChannelView from '@/app/components/ChannelView';

type Props = {
  params: Promise<{ id: string; cid: string }>;
};

export default async function ChannelPage({ params }: Props) {
  const { id, cid } = await params;
  return <ChannelView serverId={id} channelId={cid} />;
}

export function generateStaticParams() {
  // Same reasoning as parent: [] in dev so any channel ID is served dynamically;
  // placeholder in production for next build / Electron static export.
  return process.env.NODE_ENV === 'production' ? [{ id: 'default', cid: 'default' }] : [];
}
