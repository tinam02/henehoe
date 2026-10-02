'use client';
import AvatarCanvas from './AvatarCanvas';
import useChar from '@/app/context/CharCtx';
import { SkinTint } from './ItemAdjust';
import {
  CUSTOM_SKIN_ID,
  SKIN_IDS,
  skinLabel,
  skinSwatchOutfit,
} from '@/lib/skins';
import { OutfitItem } from '@/types';
import { Popover } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import styles from './SkinPicker.module.scss';

const SkinPicker = () => {
  // the outfit only supplies the region/version and the shape of the two slots,
  // skinSwatchOutfit swaps the body and head ids and strips everything else
  const { skinId, setSkinId, adjustItem, outfit } = useChar();
  const [opened, { toggle, close }] = useDisclosure(false);
  const currentLabel = skinLabel(skinId);
  return (
    <div className={styles.picker}>
      <Popover
        opened={opened}
        onChange={close}
        position='bottom-end'
        offset={6}
        classNames={{ dropdown: styles.dropdown }}
      >
        <Popover.Target>
          <button
            className={styles.triggerBtn}
            onClick={toggle}
            aria-label='Skin tone'
          >
            <AvatarCanvas
              className={styles.triggerImg}
              effects={false}
              who={skinSwatchOutfit(outfit, skinId)}
            />
            <span>{currentLabel.toUpperCase()}</span>
          </button>
        </Popover.Target>
        <Popover.Dropdown>
          <div className={styles.grid}>
            {SKIN_IDS.map(id => {
              const label = skinLabel(id);
              return (
                <button
                  key={id}
                  className={styles.swatchBtn}
                  data-active={id === skinId ? '' : undefined}
                  onClick={() => {
                    setSkinId(id);
                    // stays open on custom, the sliders are in here
                    if (id !== CUSTOM_SKIN_ID) close();
                  }}
                  title={`${label} (${id})`}
                >
                  <AvatarCanvas
                    className={styles.swatchImg}
                    effects={false}
                    who={skinSwatchOutfit(outfit, id)}
                  />
                  <span className={styles.swatchLabel}>{label}</span>
                </button>
              );
            })}
          </div>
          {skinId === CUSTOM_SKIN_ID && (
            <SkinTint
              body={outfit.selectedItems.Body as OutfitItem}
              onChange={patch => {
                adjustItem('Body', patch);
                adjustItem('Head', patch);
              }}
            />
          )}
        </Popover.Dropdown>
      </Popover>
    </div>
  );
};

export default SkinPicker;
