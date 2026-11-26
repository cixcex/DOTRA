import { RotateCcw } from 'lucide-react';
import type { CropTransform, ImageAdjustments } from '@/engine/types';
import { SliderRow, Button, SectionLabel } from './primitives';

export function CropEditor({
  crop, onChangeCrop, adjustments, onChangeAdjustments,
}: {
  crop: CropTransform;
  onChangeCrop: (c: CropTransform) => void;
  adjustments: ImageAdjustments;
  onChangeAdjustments: (a: ImageAdjustments) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Framing</SectionLabel>
        <div className="space-y-4">
          <SliderRow
            label="Zoom"
            value={crop.zoom}
            min={1}
            max={4}
            step={0.01}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => onChangeCrop({ ...crop, zoom: v })}
          />
          <SliderRow
            label="Pan X"
            value={crop.x}
            min={-0.5}
            max={0.5}
            step={0.005}
            format={(v) => v.toFixed(2)}
            onChange={(v) => onChangeCrop({ ...crop, x: v })}
          />
          <SliderRow
            label="Pan Y"
            value={crop.y}
            min={-0.5}
            max={0.5}
            step={0.005}
            format={(v) => v.toFixed(2)}
            onChange={(v) => onChangeCrop({ ...crop, y: v })}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChangeCrop({ zoom: 1, x: 0, y: 0 })}
            className="gap-1.5"
          >
            <RotateCcw size={13} />
            Reset framing
          </Button>
        </div>
      </div>
      <div className="border-t border-line/70 pt-4">
        <SectionLabel>Tone adjustments — applied before sampling</SectionLabel>
        <div className="space-y-4">
          <SliderRow
            label="Brightness"
            value={adjustments.brightness}
            min={-100}
            max={100}
            step={1}
            format={(v) => (v > 0 ? `+${v}` : `${v}`)}
            onChange={(v) => onChangeAdjustments({ ...adjustments, brightness: v })}
          />
          <SliderRow
            label="Contrast"
            value={adjustments.contrast}
            min={-100}
            max={100}
            step={1}
            format={(v) => (v > 0 ? `+${v}` : `${v}`)}
            onChange={(v) => onChangeAdjustments({ ...adjustments, contrast: v })}
          />
          <SliderRow
            label="Saturation"
            value={adjustments.saturation}
            min={-100}
            max={100}
            step={1}
            format={(v) => (v > 0 ? `+${v}` : `${v}`)}
            onChange={(v) => onChangeAdjustments({ ...adjustments, saturation: v })}
          />
        </div>
      </div>
    </div>
  );
}
