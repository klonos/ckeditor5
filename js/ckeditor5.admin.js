(function ($, Backdrop) {

"use strict";

Backdrop.behaviors.ckeditor5Admin = {
  attach: function (context, settings) {
    var $context = $(context);

    // Set up toolbar drag-and-drop interface and add/remove allowed HTML tags.
    $context.find('.ckeditor5-toolbar-configuration').once('ckeditor5-toolbar', function() {
      var $wrapper = $(this);
      var $textareaWrapper = $wrapper.find('.form-item-editor-settings-toolbar').hide();
      var $textarea = $textareaWrapper.find('textarea');
      var $toolbarAdmin = $(settings.ckeditor5.toolbarAdmin);
      var sortableSettings = {
        connectWith: '.ckeditor5-buttons',
        placeholder: 'ckeditor5-button-placeholder',
        forcePlaceholderSize: true,
        tolerance: 'pointer',
        cursor: 'move',
        stop: adminToolbarStopDrag
      };
      $toolbarAdmin.insertAfter($textareaWrapper);

      // Remove the invalid buttons after a delay to allow all behaviors to
      // finish attaching.
      window.setTimeout(function() {
        adminToolbarRemoveInvalidButtons();
        adminToolbarInitializeButtons();
      }, 10);

      // Add draggable/sortable behaviors.
      $toolbarAdmin.find('.ckeditor5-buttons').sortable(sortableSettings);
      $toolbarAdmin.find('.ckeditor5-multiple-buttons li').draggable({
        connectToSortable: '.ckeditor5-toolbar-active .ckeditor5-buttons',
        helper: 'clone'
      });

      // Disable clicking on the individual buttons.
      $toolbarAdmin.find('.ckeditor5-button a').click(function(event) {
        return false;
      });

      // Add the handler for adding/removing row buttons.
      $toolbarAdmin.bind('click.ckeditor5AddRow', function(event) {
        if ($(event.target).is('a.ckeditor5-row-add')) {
          adminToolbarAddRow.apply(event.target, [event]);
        }
      });
      $toolbarAdmin.bind('click.ckeditor5AddRow', function(event) {
        if ($(event.target).is('a.ckeditor5-row-remove')) {
          adminToolbarRemoveRow.apply(event.target, [event]);
        }
      });
      $toolbarAdmin.find('a.ckeditor5-row-remove:first').hide();

      /**
       * Add a new row of buttons.
       */
      function adminToolbarAddRow(event) {
        var $rows = $(this).closest('.ckeditor5-toolbar-active').find('.ckeditor5-row');
        var $newRow = $rows.last().clone();
        $newRow.find('li').remove();
        $newRow.insertAfter($rows.last());
        $newRow.find('.ckeditor5-buttons').sortable(sortableSettings);
        $newRow.find('.ckeditor5-row-controls a').show();
        event.preventDefault();
      }

      /**
       * Remove a row of buttons.
       */
      function adminToolbarRemoveRow(event) {
        var $rows = $(this).closest('.ckeditor5-toolbar-active').find('.ckeditor5-row');
        if ($rows.length === 1) {
          $(this).hide();
        }
        if ($rows.length > 1) {
          var $lastRow = $rows.last();
          var $disabledButtons = $wrapper.find('.ckeditor5-toolbar-disabled .ckeditor5-buttons');
          var $buttonsToDisable = $lastRow.find().children(':not(.ckeditor5-multiple-button)');
          $buttonsToDisable.prependTo($disabledButtons);
          $buttonsToDisable.each(function(n) {
            adminToolbarButtonMoved($buttonsToDisable.eq(n));
          });
          $lastRow.find('.ckeditor5-buttons').sortable('destroy');
          $lastRow.remove();
          adminToolbarUpdateValue();
        }
        event.preventDefault();
      }

      /**
       * jQuery Sortable stop event. Save updated toolbar positions to the textarea.
       */
      function adminToolbarStopDrag(event, ui) {
        var $element = ui.item;
        // Remove separators when dragged out.
        if ($element.is('.ckeditor5-button-separator') && $element.closest('.ckeditor5-active-toolbar-configuration').length === 0) {
          $element.remove();
        }
        // Notify the filter system of updated or removed features.
        adminToolbarButtonMoved($element);
        adminToolbarUpdateValue();
      }

      /**
       * Notify the filter system of any button changes.
       */
      function adminToolbarButtonMoved($element) {
        var buttonFeature = adminToolbarButtonCreateFeature($element);
        var buttonAdded = $element.closest('.ckeditor5-active-toolbar-configuration').length !== 0;
        if (buttonFeature) {
          if (buttonAdded) {
            Backdrop.editorConfiguration.addedFeature(buttonFeature);
          }
          else {
            Backdrop.editorConfiguration.removedFeature(buttonFeature);
          }
        }
      }

      /**
       * Convert a string of CKEditor tag syntax into an object.
       *
       * @param string htmlTag
       *   An HTML string such as '<a href class="external internal">'.
       * @return object
       *   An object with the following keys:
       *   - tags: An array of the tags passed in (only one is supported).
       *   - attributes: An array of attributes on the tags.
       *   - styles: An array of style attributes on the tags.
       *   - classes: An array of all class names from this tag.
       */
      function adminToolbarSplitTag(htmlTag) {
        // Match everything outside of quotes within the tag.
        var attributes = htmlTag.match(/([a-z\-]+)(?:=?['"].*?['"])?/ig);
        // Pop off the first match, which is the tag name itself.
        var tagName = attributes.shift();
        var classList = [], styleList = [];
        if (attributes.indexOf('class') > -1) {
          var classMatches = htmlTag.match(/class=\"([a-z_\- ]+)\"/);
          if (classMatches) {
            classList = classMatches[1].split(/\s/)
          }
        }
        if (attributes.indexOf('style') > -1) {
          var styleMatches = htmlTag.match(/style=\"([a-z_\- ]+)\"/)[1].split(/\s/);
          if (styleMatches) {
            styleList = styleMatches[1].split(/\s/)
          }
        }
        return {
          attributes: attributes,
          tags: [tagName],
          classes: classList,
          styles: styleList,
        };
      }

      /**
       * Create a Backdrop.EditorFeatureHTMLRule instance based on a button DOM element.
       */
      function adminToolbarButtonCreateFeature($element) {
        var requiredHtml = $element.data('required-html') || [];
        var optionalHtml = $element.data('optional-html') || [];
        var buttonName = $element.data('button-name');
        var buttonFeature, buttonRule, buttonRuleDefinition;
        if (buttonName) {
          buttonFeature = new Backdrop.EditorFeature(buttonName);
          requiredHtml.forEach(htmlTag => {
            buttonRuleDefinition = adminToolbarSplitTag(htmlTag);
            buttonRuleDefinition.required = true;
            buttonRule = new Backdrop.EditorFeatureHTMLRule(buttonRuleDefinition);
            buttonFeature.addHTMLRule(buttonRule);
          });
          optionalHtml.forEach(htmlTag => {
            buttonRuleDefinition = adminToolbarSplitTag(htmlTag);
            buttonRuleDefinition.required = false;
            buttonRule = new Backdrop.EditorFeatureHTMLRule(buttonRuleDefinition);
            buttonFeature.addHTMLRule(buttonRule);
          });
        }
        else {
          buttonFeature = false;
        }

        return buttonFeature;
      }

      /**
       * Update the toolbar value textarea.
       */
      function adminToolbarUpdateValue() {
        // Update the toolbar config after updating a sortable.
        var toolbarConfig = [];
        $wrapper.find('.ckeditor5-row').each(function() {
          $(this).find('.ckeditor5-button').each(function() {
            toolbarConfig.push($(this).data('button-name'));
          });
          // CKEditor5 uses a dash to indicate a line break in a row.
          toolbarConfig.push('-');
        });
        // Remove the last row line break.
        toolbarConfig.pop();
        $textarea.val(JSON.stringify(toolbarConfig));
      }

      /**
       * Remove a single button from the toolbar.
       */
      function adminToolbarRemoveButton($button, feature) {
        $button.remove();

        // Put the button back into the disabled list if it's not a separator.
        if ($button.is('.ckeditor5-button')) {
          $wrapper.find('.ckeditor5-toolbar-disabled .ckeditor5-buttons').prepend($button);
        }

        // Fire event indicating this button/feature was removed.
        Backdrop.editorConfiguration.removedFeature(feature);
      }

      /**
       * Notify the editor system of the initial button state.
       */
      function adminToolbarInitButton($button, feature, enabled) {
        // Fire event indicating this button's initial status.
        Backdrop.editorConfiguration.initFeature(feature, enabled);
      }

      /**
       * Ensure the configuration of the toolbar is allowed by the filters.
       */
      function adminToolbarRemoveInvalidButtons() {
        var rules = Backdrop.filterConfiguration.getCombinedFilterRules();
        $wrapper.find('.ckeditor5-toolbar-active .ckeditor5-button').each(function () {
          var $button = $(this);
          var feature = adminToolbarButtonCreateFeature($button);
          if (feature && !Backdrop.editorConfiguration.featureIsAllowed(feature, rules)) {
            adminToolbarRemoveButton($button, feature);
          }
        });
      }

      /**
       * Notify listeners to the initial state of the buttons/features.
       */
      function adminToolbarInitializeButtons() {
        $wrapper.find('.ckeditor5-toolbar-active .ckeditor5-button').each(function () {
          var $button = $(this);
          var feature = adminToolbarButtonCreateFeature($button);
          adminToolbarInitButton($button, feature, true);
        });
        $wrapper.find('.ckeditor5-toolbar-disabled .ckeditor5-button').each(function() {
          var $button = $(this);
          var feature = adminToolbarButtonCreateFeature($button);
          adminToolbarInitButton($button, feature, false);
        });
      }
    });

    // Adding or removing a heading option needs to add matching HTML tag.
    $context.find('.ckeditor5-heading-list').once('ckeditor5-heading-list', function() {
      var $checkboxes = $(this).find('input:checkbox');
      var headingFeatures = {};
      $checkboxes.each(function() {
        var headingLevel = this.value;
        var headingFeature = new Backdrop.EditorFeature(headingLevel);
        var headingRule = new Backdrop.EditorFeatureHTMLRule({
          'required': true,
          'tags': [headingLevel]
        });
        headingFeature.addHTMLRule(headingRule)
        Backdrop.editorConfiguration.initFeature(headingFeature);
        headingFeatures[headingLevel] = headingFeature;
      });

      $checkboxes.on('change', function() {
        var headingLevel = this.value;
        var headingFeature = headingFeatures[headingLevel];
        if (this.checked) {
          Backdrop.editorConfiguration.addedFeature(headingFeature);
        }
        else {
          Backdrop.editorConfiguration.removedFeature(headingFeature);
        }
      });
    });
  }
};

/**
 * Respond to the events of the editor system.
 *
 * This handles hiding/showing options based on the enabling, disabling, and
 * initial state of buttons.
 */
Backdrop.behaviors.ckeditor5AdminToggle = {
  'attach': function(context, settings) {
    var ckeditor5AdminToggleDependency = function(featureName, enabled) {
      $('[data-ckeditor5-feature-dependency]').each(function() {
        var $element = $(this);
        var dependency = $element.data('ckeditor5-feature-dependency');
        var tab = $element.data('verticalTab');
        if (dependency === featureName) {
          if (enabled) {
            $element.show();
            tab && tab.tabShow();
          }
          else {
            $element.hide();
            tab && tab.tabHide();
          }
        }
      });
    };

    $(context).find('#filter-admin-format-form').once('ckeditor5-settings-toggle', function() {
      $(this).find('[data-ckeditor5-feature-dependency]').hide();
      $(document).on('backdropEditorFeatureInit.ckeditor5AdminToggle', function(e, feature, enabled) {
        ckeditor5AdminToggleDependency(feature.name, enabled);
      });
      $(document).on('backdropEditorFeatureAdded.ckeditor5AdminToggle', function(e, feature) {
        ckeditor5AdminToggleDependency(feature.name, true);
      });
      $(document).on('backdropEditorFeatureRemoved.ckeditor5AdminToggle', function(e, feature) {
        ckeditor5AdminToggleDependency(feature.name, false);
      });
    });
  },
  'detach': function(context, settings) {
    $(context).find('#filter-admin-format-form').each(function() {
      $(document).off('.ckeditor5AdminToggle');
    });
  }
};

})(jQuery, Backdrop);
