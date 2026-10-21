// SPDX-License-Identifier: AGPL-3.0-only
import { formatTime } from '@ert/i18n'
import { useState } from 'react'
import { useApp } from './context.js'
import { sourceCodeUrl } from './source-link.js'
import { Banner, Button, Checkbox, Clock, DateField, HintFrame, ListRow, Select, StatusBadge, TextField, TextLink } from './ui/components.js'

const SAMPLE = new Date(2026, 9, 15, 14, 30)

export function PreviewPage() {
  const { t, locale } = useApp()
  const [name, setName] = useState('')
  const [distance, setDistance] = useState('short')
  const [continued, setContinued] = useState(false)
  const [rowPressed, setRowPressed] = useState(false)
  const [consent, setConsent] = useState(false)
  const [date, setDate] = useState('2027-06-12')
  return (
    <section data-testid="component-preview">
      <h1>{t('preview.title')}</h1>
      <p className="lead">{t('preview.lead')}</p>
      <HintFrame hintKey="preview.hint.fields" testId="preview-hint">
        <section className="ui-section" aria-labelledby="preview-buttons-title">
          <h2 id="preview-buttons-title">{t('preview.buttonsTitle')}</h2>
          <div className="ui-actions">
            <Button variant="primary" data-testid="preview-primary" onClick={() => setContinued(true)}>{t('preview.primary')}</Button>
            <Button variant="secondary" data-testid="preview-secondary">{t('action.cancel')}</Button>
            <Button variant="danger" data-testid="preview-danger">{t('preview.danger')}</Button>
          </div>
          {continued ? <Banner tone="ok" testId="preview-done">{t('preview.done')}</Banner> : null}
        </section>
        <section className="ui-section" aria-labelledby="preview-fields-title">
          <h2 id="preview-fields-title">{t('preview.fieldsTitle')}</h2>
          <TextField id="preview-name" label={t('preview.name')} value={name} onChange={setName} autoComplete="off" testId="preview-name" />
          <Select
            id="preview-distance"
            label={t('preview.distanceTitle')}
            value={distance}
            onChange={setDistance}
            testId="preview-distance"
            options={[
              { value: 'short', label: t('preview.distance.short') },
              { value: 'long', label: t('preview.distance.long') },
            ]}
          />
        </section>
        <section className="ui-section" aria-labelledby="preview-notices-title">
          <h2 id="preview-notices-title">{t('preview.noticesTitle')}</h2>
          <Banner tone="info">{t('preview.noticeInfo')}</Banner>
          <Banner tone="warning">{t('preview.noticeWarning')}</Banner>
          <Banner tone="danger">{t('preview.noticeDanger')}</Banner>
          <Banner tone="ok">{t('preview.noticeOk')}</Banner>
        </section>
        <section className="ui-section" aria-labelledby="preview-list-title">
          <h2 id="preview-list-title">{t('preview.listTitle')}</h2>
          <ListRow
            title={t('preview.rowTitle')}
            detail={t('preview.rowDetail')}
            pressed={rowPressed}
            onPress={() => setRowPressed((current) => !current)}
            testId="preview-row"
            trailing={<StatusBadge tone="ok">{t('status.registered')}</StatusBadge>}
          />
        </section>
        <section className="ui-section" aria-labelledby="preview-statuses-title">
          <h2 id="preview-statuses-title">{t('preview.statusesTitle')}</h2>
          <div className="ui-badges">
            <StatusBadge tone="neutral">{t('status.registered')}</StatusBadge>
            <StatusBadge tone="ok">{t('status.started')}</StatusBadge>
            <StatusBadge tone="warning">{t('status.finished')}</StatusBadge>
            <StatusBadge tone="danger">{t('status.dnf')}</StatusBadge>
          </div>
        </section>
        <section className="ui-section" aria-labelledby="preview-clock-title">
          <h2 id="preview-clock-title">{t('preview.clockTitle')}</h2>
          <Clock label={t('preview.clockLabel')} value={formatTime(SAMPLE, locale)} testId="preview-clock" />
        </section>
        <section className="ui-section" aria-labelledby="preview-links-title">
          <h2 id="preview-links-title">{t('preview.linksTitle')}</h2>
          <TextLink href={sourceCodeUrl(__ERT_SOURCE_REF__)} rel="noreferrer" testId="preview-link">{t('common.source')}</TextLink>
        </section>
        <section className="ui-section" aria-labelledby="preview-check-title">
          <h2 id="preview-check-title">{t('preview.checkTitle')}</h2>
          <Checkbox id="preview-check" label={t('entries.consentText')} checked={consent} onChange={setConsent} testId="preview-check" />
        </section>
        <section className="ui-section" aria-labelledby="preview-date-title">
          <h2 id="preview-date-title">{t('preview.dateTitle')}</h2>
          <DateField id="preview-date" label={t('wizard.date')} hint={t('wizard.dateHint')} errorMessage={t('wizard.dateError')} value={date} onChange={setDate} testId="preview-date" />
        </section>
      </HintFrame>
    </section>
  )
}
