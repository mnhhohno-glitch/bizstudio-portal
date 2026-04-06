"use client";

import ScheduleEntryCard from "./ScheduleEntryCard";
import type { ScheduleEntryCardProps } from "./ScheduleEntryCard";
import NowIndicator, { getCurrentTimeJST } from "./NowIndicator";
import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface DailyTimelineProps {
  entries: ScheduleEntryCardProps[];
  summary?: string | null;
  isToday?: boolean;
  onReorder?: (activeId: string, overId: string) => void;
}

function SortableEntry({ entry, canDrag }: { entry: ScheduleEntryCardProps; canDrag: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.entryId || "" });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ScheduleEntryCard
        {...entry}
        canDrag={canDrag}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export default function DailyTimeline({ entries, isToday = false, onReorder }: DailyTimelineProps) {
  const [now, setNow] = useState(getCurrentTimeJST);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => setNow(getCurrentTimeJST()), 60000);
    return () => clearInterval(interval);
  }, [isToday]);

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-[#9CA3AF]">
        スケジュール未作成
      </div>
    );
  }

  const canDrag = entries.some((e) => e.canEdit) && !!onReorder;
  const entryIds = entries.map((e) => e.entryId || "");
  const activeEntry = activeId ? entries.find((e) => e.entryId === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder?.(active.id as string, over.id as string);
  }

  const renderEntries = (entryList: ScheduleEntryCardProps[]) => {
    if (!canDrag) {
      return entryList.map((entry, i) => (
        <ScheduleEntryCard key={entry.entryId || i} {...entry} />
      ));
    }

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
          {entryList.map((entry) => (
            <SortableEntry key={entry.entryId} entry={entry} canDrag={canDrag} />
          ))}
        </SortableContext>
        <DragOverlay>
          {activeEntry ? (
            <div className="shadow-lg rounded-lg">
              <ScheduleEntryCard {...activeEntry} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  };

  if (!isToday) {
    return <div className="space-y-1">{renderEntries(entries)}</div>;
  }

  // For today, insert NowIndicator
  if (!canDrag) {
    const elements: React.ReactNode[] = [];
    let nowInserted = false;

    entries.forEach((entry, i) => {
      const isActive = !nowInserted && now >= entry.startTime && now < entry.endTime;

      if (!nowInserted && now < entry.startTime) {
        elements.push(<NowIndicator key="now" />);
        nowInserted = true;
      }

      elements.push(
        <ScheduleEntryCard key={entry.entryId || i} {...entry} isActive={isActive} />
      );

      if (isActive) {
        elements.push(<NowIndicator key="now" />);
        nowInserted = true;
      }
    });

    if (!nowInserted) {
      elements.push(<NowIndicator key="now" />);
    }

    return <div className="space-y-1">{elements}</div>;
  }

  // Today + draggable: NowIndicator outside DndContext
  const nowIdx = entries.findIndex((e) => now < e.startTime);
  const activeIdx = entries.findIndex((e) => now >= e.startTime && now < e.endTime);

  return (
    <div className="space-y-1">
      {nowIdx === 0 && <NowIndicator />}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
          {entries.map((entry, i) => {
            const isActive = i === activeIdx;
            return (
              <div key={entry.entryId}>
                <SortableEntry
                  entry={{ ...entry, isActive }}
                  canDrag={canDrag}
                />
                {isActive && <NowIndicator />}
                {nowIdx > 0 && nowIdx === i + 1 && !isActive && <NowIndicator />}
              </div>
            );
          })}
        </SortableContext>
        <DragOverlay>
          {activeEntry ? (
            <div className="shadow-lg rounded-lg">
              <ScheduleEntryCard {...activeEntry} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {nowIdx === -1 && activeIdx === -1 && <NowIndicator />}
    </div>
  );
}
