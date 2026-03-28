import { useCallback, useRef, useState } from 'react';
import { useTerminalsStore, type LayoutNode } from '../stores/terminals';
import { TerminalPane } from './TerminalPane';
import './SplitLayout.css';

interface SplitLayoutProps {
  node: LayoutNode;
  workspaceId: string;
}

export function SplitLayout({ node, workspaceId }: SplitLayoutProps) {
  const closePane = useTerminalsStore((s) => s.closePane);
  const splitPane = useTerminalsStore((s) => s.splitPane);
  const resizeSplit = useTerminalsStore((s) => s.resizeSplit);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleStartDrag = useCallback(
    (splitId: string, direction: 'horizontal' | 'vertical') =>
      (e: React.MouseEvent) => {
        e.preventDefault();
        setDragging(true);

        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();

        const onMouseMove = (ev: MouseEvent) => {
          let ratio: number;
          if (direction === 'horizontal') {
            ratio = (ev.clientX - rect.left) / rect.width;
          } else {
            ratio = (ev.clientY - rect.top) / rect.height;
          }
          resizeSplit(workspaceId, splitId, ratio);
        };

        const onMouseUp = () => {
          setDragging(false);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      },
    [workspaceId, resizeSplit]
  );

  if (node.type === 'terminal') {
    return (
      <TerminalPane
        paneId={node.id}
        terminalId={node.terminalId}
        onClose={() => closePane(workspaceId, node.id)}
        onSplit={(direction) => splitPane(workspaceId, node.id, direction)}
      />
    );
  }

  const { direction, children, ratio, id: splitId } = node;

  return (
    <div
      ref={containerRef}
      className={`split split--${direction}${dragging ? ' split--dragging' : ''}`}
    >
      <div className="split-child" style={{ flex: ratio }}>
        <SplitLayout node={children[0]} workspaceId={workspaceId} />
      </div>
      <div
        className={`split-handle${dragging ? ' split-handle--dragging' : ''}`}
        onMouseDown={handleStartDrag(splitId, direction)}
      />
      <div className="split-child" style={{ flex: 1 - ratio }}>
        <SplitLayout node={children[1]} workspaceId={workspaceId} />
      </div>
    </div>
  );
}
